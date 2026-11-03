import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Pool } from "pg";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { createBarber } from "@/server/services/barber.service";
import type { UserRole } from "@/server/schemas/user.schema";
let db: Pool;
let actor: { id: number; role: UserRole } | null;
mock.module("@/server/auth/session", { namedExports: { getCurrentUser: async () => actor } });
mock.module("@/server/db/pool", { namedExports: { pool: { query: (...args: Parameters<Pool["query"]>) => db.query(...args), connect: () => db.connect() } } });
const collection = await import("@/app/api/barbers/route");
const item = await import("@/app/api/barbers/[id]/route");
const status = await import("@/app/api/barbers/[id]/status/route");
const schedule = await import("@/app/api/barbers/[id]/schedule/route");
const hours = await import("@/app/api/shop-hours/route");
const request = (body: unknown = {}, query = "") => new Request(`http://localhost/api/barbers${query}`, { method: "POST", body: JSON.stringify(body) });

test("barber and hours APIs enforce assigned branches, roles and IDs; Administrator remains global", { skip: !databaseConfigured }, async () => {
  const fixture = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z"); db = fixture.db;
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Second','SECOND') RETURNING id")).rows[0].id);
    const a = await createBarber(db, { branchId: main, firstName: "Main", lastName: "Barber", status: "available" });
    const b = await createBarber(db, { branchId: second, firstName: "Second", lastName: "Barber", status: "available" });
    const foreign = { params: Promise.resolve({ id: String(b.id) }) };
    const shift = { dayOfWeek: 1, isWorking: true, startTime: "10:00", endTime: "18:00", breaks: [] };
    const mainBarberIds = [a.id];
    for (const role of ["manager", "front_desk"] as const) {
      const id = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Staff','Test',$1,'test',(SELECT id FROM roles WHERE name=$2)) RETURNING id", [`${role}@test.local`, role])).rows[0].id);
      await db.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,true)", [id, main]); actor = { id, role };
      const scoped = (await (await collection.GET(request())).json()).barbers;
      assert.deepEqual(scoped.map((barber: { id: number }) => barber.id).sort(), [...mainBarberIds].sort());
      assert.equal(typeof scoped[0].operationalAvailability.available, "boolean");
      assert.ok("reason" in scoped[0].operationalAvailability);
      assert.equal((await collection.GET(request({}, `?branchId=${second}`))).status, 403);
      assert.equal((await item.GET(request(), foreign)).status, 403);
      assert.equal((await status.PATCH(request({ status: "busy" }), foreign)).status, 403);
      for (const op of [() => schedule.GET(request(), foreign), () => schedule.PUT(request(shift), foreign), () => schedule.POST(request({ startsAt: "2026-11-01T10:00:00Z", endsAt: "2026-11-01T11:00:00Z", reason: "Away" }), foreign), () => schedule.DELETE(request({}, "?periodId=1"), foreign)]) assert.equal((await op()).status, 403);
      assert.equal((await hours.GET(request({}, `?branchId=${second}`))).status, 403);
      assert.equal((await hours.PUT(request({ dayOfWeek: 1, openTime: "10:00", closeTime: "18:00", isClosed: false }, `?branchId=${second}`))).status, 403);
      assert.equal((await collection.POST(request({ branchId: second, firstName: "Denied", lastName: "Test", status: "available" }))).status, 403);
      assert.equal((await item.PUT(request({ branchId: main, firstName: "Denied", lastName: "Test", status: "available" }), foreign)).status, 403);
      assert.equal((await hours.GET(request({}, `?branchId=${main}`))).status, 200);
      assert.equal((await hours.PUT(request({ dayOfWeek: 1, openTime: "09:00", closeTime: "19:30", isClosed: false }, `?branchId=${main}`))).status, role === "manager" ? 200 : 403);
      if (role === "manager") {
        const created = await collection.POST(request({ branchId: main, firstName: "Manager", lastName: "Created", status: "available" }));
        assert.equal(created.status, 201); mainBarberIds.push((await created.json()).barber.id);
        assert.equal((await schedule.PUT(request(shift), { params: Promise.resolve({ id: String(a.id) }) })).status, 200);
        assert.equal((await item.PUT(request({ branchId: main, firstName: "Denied", lastName: "Test", status: "available", commissionRate: 90 }), { params: Promise.resolve({ id: String(a.id) }) })).status, 400);
        assert.equal((await collection.POST(request({ firstName: "Missing", lastName: "Branch", status: "available" }))).status, 400);
        await db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [id, second]);
        assert.equal((await schedule.GET(request(), foreign)).status, 200);
        assert.equal((await collection.GET(request({}, `?branchId=${second}`))).status, 200);
      } else {
        assert.equal((await schedule.GET(request(), { params: Promise.resolve({ id: String(a.id) }) })).status, 403);
      }
    }
    actor = { id: 999, role: "administrator" };
    assert.equal((await (await collection.GET(request())).json()).barbers.length, 3);
    assert.equal((await item.GET(request(), foreign)).status, 200);
    assert.equal((await schedule.GET(request(), foreign)).status, 200);
    assert.equal((await hours.PUT(request({ dayOfWeek: 1, openTime: "11:00", closeTime: "18:00", isClosed: false }, `?branchId=${second}`))).status, 200);
    assert.equal((await collection.POST(request({ branchId: second, firstName: "Admin", lastName: "Created", status: "available", commissionRate: null }))).status, 201);
    for (const role of ["customer", "supplier"] as const) {
      actor = { id: 999, role };
      for (const op of [() => item.GET(request(), foreign), () => status.PATCH(request({ status: "busy" }), foreign), () => schedule.GET(request(), foreign), () => collection.POST(request({})), () => hours.PUT(request({}))]) assert.equal((await op()).status, 403);
    }
    actor = null; assert.equal((await collection.GET(request())).status, 401);
  } finally { await fixture.cleanup(); }
});

const bookings = await import("@/app/api/bookings/route");
const bookingItem = await import("@/app/api/bookings/[id]/route");
const queueApi = await import("@/app/api/queue/route");
const queueItem = await import("@/app/api/queue/[id]/route");
const bookingServices = await import("@/server/services/booking.service");
const queueServices = await import("@/server/services/queue.service");
const availability = await import("@/server/services/booking-availability.service");

test("Phase 3 visits persist branch ownership, isolate staff access and inherit appointment branches", { skip: !databaseConfigured }, async () => {
  const fixture = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z"); db = fixture.db;
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Visit branch','VISIT') RETURNING id")).rows[0].id);
    const a = await createBarber(db, { branchId: main, firstName: "Main", lastName: "Barber", status: "available" });
    const b = await createBarber(db, { branchId: second, firstName: "Second", lastName: "Barber", status: "available" });
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false");
    await db.query("UPDATE barber_schedules SET start_time='00:00',end_time='23:59',is_working=true");
    const user = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Visit','Customer','visit@test.local','test',(SELECT id FROM roles WHERE name='customer')) RETURNING id")).rows[0].id);
    const customerId = Number((await db.query("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [user])).rows[0].id);
    const staffId = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Visit','Staff','visit-staff@test.local','test',(SELECT id FROM roles WHERE name='front_desk')) RETURNING id")).rows[0].id);
    await db.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,true)", [staffId, second]);
    actor = { id: staffId, role: "front_desk" };
    const input = { customerId, serviceId: "barracks-basic", barberId: b.id, date: "2026-11-05", time: "12:00" };
    const created = await bookings.POST(request(input, `?branchId=${second}`));
    assert.equal(created.status, 201);
    const booking = (await created.json()).booking;
    assert.equal(booking.branchId, second);
    const walked = await queueApi.POST(request({ customerId, serviceId: input.serviceId, idempotencyKey: "80eeff0a-bc02-4d1d-8415-18df4533ee7f" }, `?branchId=${second}`));
    assert.equal(walked.status, 201);
    const walk = (await walked.json()).entry;
    assert.equal(walk.branchId, second);
    await bookingServices.updateBooking(db, booking.id, { status: "checked_in" });
    const appointment = (await queueServices.listQueue(db, "active", second)).find((entry) => entry.bookingId === booking.id)!;
    assert.equal(appointment.branchId, second);
    assert.equal((await bookings.POST(request({ ...input, barberId: a.id, time: "13:00" }, `?branchId=${second}`))).status, 400);
    await assert.rejects(queueServices.assignQueueBarber(db, walk.id, a.id), /visit branch/);
    const candidates = await availability.findAvailableBarbers(db, { serviceId: input.serviceId, date: input.date, time: "14:00", branchId: second });
    assert.deepEqual(candidates, [b.id]);
    const foreignBooking = { params: Promise.resolve({ id: String(booking.id) }) };
    const foreignQueue = { params: Promise.resolve({ id: String(walk.id) }) };
    await db.query("DELETE FROM user_branches WHERE user_id=$1", [staffId]);
    await db.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,true)", [staffId, main]);
    for (const role of ["manager", "front_desk"] as const) {
      actor = { id: staffId, role };
      assert.equal((await bookings.GET(request({}, `?branchId=${second}`))).status, 403);
      assert.equal((await queueApi.GET(request({}, `?branchId=${second}`))).status, 403);
    }
    actor = { id: staffId, role: "front_desk" };
    assert.equal((await bookingItem.PATCH(request({ status: "cancelled" }), foreignBooking)).status, 403);
    assert.equal((await queueItem.PATCH(request({ barberId: b.id }), foreignQueue)).status, 403);
    actor = { id: 999, role: "administrator" };
    assert.equal((await (await bookings.GET(request({}, `?branchId=${second}`))).json()).bookings[0].id, booking.id);
    assert.equal((await (await queueApi.GET(request({}, `?branchId=${second}`))).json()).queue.length, 2);
    assert.equal((await bookings.GET(request({}, `?branchId=${main}`))).status, 200);
    const mainWalk = await queueServices.addWalkIn(db, { customerId, serviceId: input.serviceId, branchId: main });
    assert.equal((await queueServices.getNextCustomer(db, a.id, main))?.id, mainWalk.id);
  } finally { await fixture.cleanup(); }
});

const paymentApi = await import("@/app/api/transactions/route");
const payment = await import("@/server/services/payment.service");

test("Phase 4 payments inherit visit branches and enforce transaction access and database integrity", { skip: !databaseConfigured }, async () => {
  const fixture = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z"); db = fixture.db;
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Payment branch','PAY') RETURNING id")).rows[0].id);
    const barber = await createBarber(db, { branchId: second, firstName: "Payment", lastName: "Barber", status: "available" });
    const customer = Number((await db.query("INSERT INTO customers(first_name,last_name) VALUES('Payment','Customer') RETURNING id")).rows[0].id);
    const book = Number((await db.query("INSERT INTO bookings(branch_id,customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status) VALUES($1,$2,$3,'barracks-basic','Saved cut',300,'2026-11-05','12:00','completed') RETURNING id", [second, customer, barber.id])).rows[0].id);
    const walk = Number((await db.query("INSERT INTO queue_entries(branch_id,customer_id,barber_id,service_id,status,started_at,completed_at) VALUES($1,$2,$3,'barracks-basic','completed',NOW(),NOW()) RETURNING id", [second, customer, barber.id])).rows[0].id);
    const ids: Record<string, number> = {};
    for (const role of ["manager", "front_desk", "administrator"] as const) {
      ids[role] = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Payment','Operator',$1,'hash',(SELECT id FROM roles WHERE name=$2)) RETURNING id", [`payment-${role}@test.local`, role])).rows[0].id);
      if (role !== "administrator") await db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [ids[role], main]);
    }
    for (const role of ["manager", "front_desk"] as const) {
      actor = { id: ids[role], role };
      assert.equal((await paymentApi.GET(request({}, `?view=eligible&branchId=${second}`))).status, 403);
      await assert.rejects(payment.createTransaction(db, { visit: { bookingId: book }, paymentMethod: "card" }, ids[role]), { kind: "forbidden" });
    }
    actor = { id: ids.front_desk, role: "front_desk" };
    assert.equal((await paymentApi.POST(request({ visit: { queueEntryId: walk }, paymentMethod: "card" }, `?branchId=${main}`))).status, 403);
    await db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [ids.front_desk, second]);
    const paidBooking = await paymentApi.POST(request({ visit: { bookingId: book }, paymentMethod: "card" }, `?branchId=${main}`));
    assert.equal(paidBooking.status, 201);
    const sale = (await paidBooking.json()).transaction;
    assert.equal(sale.branchId, second, "visit determines ownership even when query names another branch");
    const queueSale = await payment.createTransaction(db, { visit: { queueEntryId: walk }, paymentMethod: "card" }, ids.administrator);
    assert.equal(queueSale.branchId, second);
    await db.query("DELETE FROM user_branches WHERE user_id=$1 AND branch_id=$2", [ids.front_desk, second]);
    for (const role of ["manager", "front_desk"] as const) {
      actor = { id: ids[role], role };
      const ownHistory = await (await paymentApi.GET(request({}, "?view=history"))).json();
      assert.equal(ownHistory.total, 0);
      assert.equal((await paymentApi.GET(request({}, `?reference=${sale.reference}`))).status, 404);
    }
    await assert.rejects(payment.applyFinancialAction(db, sale.reference, { action: "refund", amount: 300, reason: "Foreign branch" }, ids.manager), { kind: "forbidden" });
    const mainBarber = await createBarber(db, { branchId: main, firstName: "Main", lastName: "Payment", status: "available" });
    const mainBook = Number((await db.query("INSERT INTO bookings(branch_id,customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status) VALUES($1,$2,$3,'barracks-basic','Main cut',300,'2026-11-05','13:00','completed') RETURNING id", [main, customer, mainBarber.id])).rows[0].id);
    const mainSale = await payment.createTransaction(db, { visit: { bookingId: mainBook }, paymentMethod: "card" }, ids.administrator);
    actor = { id: ids.administrator, role: "administrator" };
    assert.equal((await (await paymentApi.GET(request({}, "?view=history"))).json()).total, 3);
    assert.equal((await (await paymentApi.GET(request({}, `?view=history&branchId=${second}`))).json()).total, 2);
    assert.equal((await paymentApi.GET(request({}, `?reference=${mainSale.reference}`))).status, 200);
    assert.equal((await paymentApi.GET(request({}, `?reference=${sale.reference}`))).status, 200);
    assert.equal((await paymentApi.GET(request({}, `?reference=${queueSale.reference}`))).status, 200);
    // BEFORE INSERT guard must reject both visit mismatches before uniqueness/tender checks.
    for (const [type, visitId] of [["booking", book], ["queue", walk]] as const) {
      await assert.rejects(db.query(`INSERT INTO transactions(branch_id,booking_id,queue_entry_id,visit_type,visit_record_id,customer_name,barber_name,service_name,amount,payment_method,status)
        VALUES($1,$2,$3,$4,$5,'Saved customer','Saved barber','Saved cut',300,'card','completed')`,
        [main, type === "booking" ? visitId : null, type === "queue" ? visitId : null, type, visitId]), { code: "23514", constraint: "transaction_visit_branch_match" });
    }
    assert.equal((await payment.findTransactionByReference(db, sale.reference))?.status, "completed");
  } finally { await fixture.cleanup(); }
});
