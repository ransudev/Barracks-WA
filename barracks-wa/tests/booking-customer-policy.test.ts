import assert from "node:assert/strict";
import test from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { createBooking } from "@/server/services/booking.service";
import { listCustomers, updateCustomer } from "@/server/services/customer.service";
import { addWalkIn, assignQueueBarber, updateWalkInStatus } from "@/server/services/queue.service";
import { isAppointmentCustomer } from "@/app/utils/booking-customers";

test("booking choices match registered-account policy while accountless editing and Queue service remain functional", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(Infinity, "2026-10-13T02:00:00Z");
  try {
    const barberId = Number((await db.query("INSERT INTO barbers(first_name,last_name) VALUES('Policy','Barber') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO barber_schedules(barber_id,day_of_week,start_time,end_time) SELECT $1,day,'09:00','19:30' FROM generate_series(0,6) day", [barberId]);
    const accountId = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Registered','Customer','policy@test.local','test',(SELECT id FROM roles WHERE name='customer')) RETURNING id")).rows[0].id);
    const registeredId = Number((await db.query("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [accountId])).rows[0].id);
    const usersBefore = (await db.query("SELECT count(*) FROM users")).rows[0].count;
    const walkIn = await addWalkIn(db, { customer: { firstName: "Accountless", lastName: "Guest", phone: "09123456789" }, serviceId: "barracks-basic" });
    const edited = await updateCustomer(db, walkIn.customerId, { firstName: "Edited", lastName: "Guest", phone: "09123456780", preferredBarberId: barberId });
    assert.equal(edited?.userId, null);
    assert.equal(edited?.firstName, "Edited");
    const customers = await listCustomers(db);
    assert.ok(customers.some((customer) => customer.id === walkIn.customerId));
    assert.deepEqual(customers.filter(isAppointmentCustomer).map((customer) => customer.id), [registeredId]);
    const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const request = { serviceId: "barracks-basic", barberId, date, time: "10:00" };
    await assert.rejects(createBooking(db, { ...request, customerId: walkIn.customerId }), { kind: "not_found", message: "Customer not found" });
    assert.equal(Number((await db.query("SELECT count(*) FROM bookings")).rows[0].count), 0);
    const booking = await createBooking(db, { ...request, customerId: registeredId });
    assert.equal(booking.customerId, registeredId);
    assert.equal(booking.status, "confirmed");
    assert.equal((await assignQueueBarber(db, walkIn.id, barberId)).status, "ready");
    assert.equal((await updateWalkInStatus(db, walkIn.id, "in_progress")).status, "in_progress");
    assert.equal((await updateWalkInStatus(db, walkIn.id, "completed")).status, "completed");
    assert.equal((await db.query("SELECT count(*) FROM users")).rows[0].count, usersBefore);

    await db.query("UPDATE users SET deleted_at=now() WHERE id=$1", [accountId]);
    assert.deepEqual((await listCustomers(db)).filter(isAppointmentCustomer), []);
    await assert.rejects(createBooking(db, { ...request, time: "12:00", customerId: registeredId }), { kind: "not_found", message: "Customer not found" });
    await db.query("UPDATE users SET deleted_at=NULL,role_id=(SELECT id FROM roles WHERE name='front_desk') WHERE id=$1", [accountId]);
    assert.deepEqual((await listCustomers(db)).filter(isAppointmentCustomer), []);
    await assert.rejects(createBooking(db, { ...request, time: "12:00", customerId: registeredId }), { kind: "not_found", message: "Customer not found" });
  } finally { await cleanup(); }
});
