import assert from "node:assert/strict";
import test from "node:test";
import { canManageBooking } from "@/app/constants/roles";
import { createBooking, updateBooking } from "@/server/services/booking.service";
import { createBarber } from "@/server/services/barber.service";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

test("customer cancellation is owner-scoped and limited to confirmed bookings", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z");
  try {
    const barber = await createBarber(db, { branchId: Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id), firstName: "Policy", lastName: "Barber", status: "available" });
    const customers: number[] = [];
    for (const index of [0, 1]) {
      const user = await db.query<{ id: number }>(`INSERT INTO users(first_name,last_name,email,password_hash,role_id)
        VALUES('Policy','Customer',$1,'test',(SELECT id FROM roles WHERE name='customer')) RETURNING id`, [`policy-${index}@test.local`]);
      const customer = await db.query<{ id: number }>("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [user.rows[0].id]);
      customers.push(customer.rows[0].id);
    }
    const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const book = (customerId: number, time: string) => createBooking(db, { customerId, barberId: barber.id, serviceId: "barracks-basic", date, time });

    const confirmed = await book(customers[0], "10:00");
    assert.equal((await updateBooking(db, confirmed.id, { status: "cancelled" }, { customerId: customers[0] }))?.status, "cancelled");

    const checkedIn = await book(customers[0], "11:00");
    assert.equal((await updateBooking(db, checkedIn.id, { status: "checked_in" }))?.status, "checked_in");
    await assert.rejects(updateBooking(db, checkedIn.id, { status: "cancelled" }, { customerId: customers[0] }), { kind: "not_updatable" });
    assert.equal((await updateBooking(db, checkedIn.id, { status: "cancelled" }))?.status, "cancelled", "staff may still cancel checked-in bookings");

    const inProgress = await book(customers[0], "12:00");
    await updateBooking(db, inProgress.id, { status: "checked_in" });
    // This lifecycle test can run outside the shop's published opening hours.
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false");
    await db.query("UPDATE barber_schedules SET start_time='00:00',end_time='23:59'");
    await updateBooking(db, inProgress.id, { status: "in_progress" });
    await assert.rejects(updateBooking(db, inProgress.id, { status: "cancelled" }, { customerId: customers[0] }), { kind: "not_updatable" });

    const otherCustomer = await book(customers[1], "13:00");
    await assert.rejects(updateBooking(db, otherCustomer.id, { status: "cancelled" }, { customerId: customers[0] }), { kind: "forbidden" });
    assert.equal((await updateBooking(db, otherCustomer.id, { status: "cancelled" }, { customerId: customers[1] }))?.status, "cancelled");
    // Staff may remove bookings; the service keeps started/completed bookings on record.
    assert.equal(canManageBooking("front_desk", "delete"), true);
    assert.equal(canManageBooking("front_desk", "cancel"), true);
    assert.equal(canManageBooking("manager", "delete"), true);
    assert.equal(canManageBooking("administrator", "delete"), true);
  } finally { await cleanup(); }
});

// Extend customer booking coverage through the real API and disposable database.
let customerBranchDb: import("pg").Pool;
let customerActor: { id: number; role: "customer" };
const { mock } = await import("node:test");
mock.module("@/server/auth/session", { namedExports: { getCurrentUser: async () => customerActor } });
mock.module("@/server/db/pool", { namedExports: { pool: {
  query: (...args: Parameters<import("pg").Pool["query"]>) => customerBranchDb.query(...args),
  connect: () => customerBranchDb.connect(),
} } });
const customerBookings = await import("@/app/api/bookings/route");
const customerBookingItem = await import("@/app/api/bookings/[id]/route");
const customerAvailability = await import("@/app/api/bookings/availability/route");
const customerBarbers = await import("@/app/api/barbers/route");
const customerHours = await import("@/app/api/shop-hours/route");
const customerServices = await import("@/app/api/services/route");
const customerBranches = await import("@/app/api/customer-branches/route");
const staffContext = await import("@/app/api/branch-context/route");

test("customer branch selection scopes bookings and availability while preserving original appointments", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z");
  customerBranchDb = db;
  const request = (path: string, body?: unknown) => new Request(`http://localhost/api/${path}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const branchA = Number((await db.query("INSERT INTO branches(name,code) VALUES('Branch A','A') RETURNING id")).rows[0].id);
    const inactive = Number((await db.query("INSERT INTO branches(name,code,status) VALUES('Inactive','OFF','inactive') RETURNING id")).rows[0].id);
    await db.query("UPDATE shop_operating_hours SET open_time='12:00',close_time='16:00' WHERE branch_id=$1", [branchA]);
    const a = await createBarber(db, { branchId: branchA, firstName: "Branch A", lastName: "Barber", status: "available" });
    const b = await createBarber(db, { branchId: main, firstName: "Main", lastName: "Barber", status: "available" });
    const userId = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Branch','Customer','branch-customer@test.local','test',(SELECT id FROM roles WHERE name='customer')) RETURNING id")).rows[0].id);
    const customerId = Number((await db.query("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [userId])).rows[0].id);
    customerActor = { id: userId, role: "customer" };
    const branchList = await (await customerBranches.GET()).json();
    assert.deepEqual(branchList.branches.map((branch: { id: number }) => branch.id).sort(), [main, branchA].sort());
    assert.equal((await staffContext.GET()).status, 403);
    const input = { serviceId: "barracks-basic", barberId: a.id, date: "2026-11-05", time: "12:00", customerId: 999999 };
    const created = await customerBookings.POST(request(`bookings?branchId=${branchA}`, input));
    assert.equal(created.status, 201);
    const booking = (await created.json()).booking;
    assert.equal(booking.branchId, branchA);
    assert.equal(booking.branchName, "Branch A");
    assert.equal(booking.customerId, customerId);
    assert.equal(Number((await db.query("SELECT branch_id FROM bookings WHERE id=$1", [booking.id])).rows[0].branch_id), branchA);
    assert.equal((await customerBookings.POST(request(`bookings?branchId=${branchA}`, { ...input, barberId: b.id, time: "13:00" }))).status, 400);
    const barberList = await (await customerBarbers.GET(request(`barbers?branchId=${branchA}`))).json();
    assert.deepEqual(barberList.barbers.map((barber: { id: number }) => barber.id), [a.id]);
    const available = await (await customerAvailability.GET(request(`bookings/availability?branchId=${branchA}&serviceId=${input.serviceId}&date=2026-11-06`))).json();
    assert.equal(available.slots[0].startTime, "12:00");
    assert.ok(available.slots.every((slot: { startTime: string; endTime: string }) => slot.startTime >= "12:00" && slot.endTime <= "16:00"));
    assert.equal((await customerAvailability.GET(request(`bookings/availability?branchId=${branchA}&serviceId=${input.serviceId}&date=2026-11-06&barberId=${b.id}`))).status, 404);
    // Customers must choose a specific barber; Any Available Barber is staff-only.
    const anyBarberBooking = await customerBookings.POST(request(`bookings?branchId=${branchA}`, { ...input, barberId: null, date: "2026-11-07" }));
    assert.equal(anyBarberBooking.status, 400);
    const availableHours = await (await customerHours.GET(request(`shop-hours?branchId=${branchA}`))).json();
    assert.equal(availableHours.hours[0].openTime, "12:00");
    await db.query("UPDATE shop_operating_hours SET is_closed=true WHERE branch_id=$1 AND day_of_week=EXTRACT(DOW FROM DATE '2026-11-06')", [branchA]);
    assert.deepEqual((await (await customerAvailability.GET(request(`bookings/availability?branchId=${branchA}&serviceId=${input.serviceId}&date=2026-11-06`))).json()).slots, []);
    for (const invalid of [inactive, 2147483647, "bad", "", "99999999999999999999"]) {
      assert.equal((await customerBookings.POST(request(`bookings?branchId=${invalid}`, input))).status, 400);
      assert.equal((await customerBarbers.GET(request(`barbers?branchId=${invalid}`))).status, 400);
      assert.equal((await customerHours.GET(request(`shop-hours?branchId=${invalid}`))).status, 400);
      assert.equal((await customerServices.GET(request(`services?branchId=${invalid}`))).status, 400);
      assert.equal((await customerAvailability.GET(request(`bookings/availability?branchId=${invalid}&serviceId=${input.serviceId}&date=2026-11-06`))).status, 400);
    }
    await assert.rejects(createBooking(db, { ...input, customerId, branchId: inactive }), /active branch/);
    // A later selection affects new booking reads, never the ownership of ID edits or history.
    const defaultBooking = await customerBookings.POST(request("bookings", { ...input, barberId: b.id, time: "10:00" }));
    assert.equal(defaultBooking.status, 201);
    assert.equal((await defaultBooking.json()).booking.branchId, main);
    const edited = await customerBookingItem.PUT(request(`bookings/${booking.id}?branchId=${main}`, { serviceId: input.serviceId, barberId: a.id, date: input.date, time: "13:00" }), { params: Promise.resolve({ id: String(booking.id) }) });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).booking.branchId, branchA);
    const history = await (await customerBookings.GET(request(`bookings?branchId=${main}`))).json();
    assert.equal(history.bookings.find((row: { id: number }) => row.id === booking.id).branchId, branchA);
    await db.query("UPDATE branches SET status='inactive' WHERE id=$1", [branchA]);
    assert.equal((await (await customerBookings.GET(request("bookings"))).json()).bookings.find((row: { id: number }) => row.id === booking.id).branchName, "Branch A");
    assert.equal((await customerBookingItem.PUT(request(`bookings/${booking.id}`, { serviceId: input.serviceId, barberId: a.id, date: "2026-11-08", time: "14:00" }), { params: Promise.resolve({ id: String(booking.id) }) })).status, 409);
    assert.equal((await customerBookingItem.PATCH(request(`bookings/${booking.id}`, { status: "cancelled" }), { params: Promise.resolve({ id: String(booking.id) }) })).status, 200);
  } finally { await cleanup(); }
});
