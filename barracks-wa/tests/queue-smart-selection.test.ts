import assert from "node:assert/strict";
import test from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

test("Next Customer skips conflicts, keeps appointment priority, and rechecks assignments", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z");
  const queue = await import("@/server/services/queue.service");
  const { updateBooking } = await import("@/server/services/booking.service");
  try {
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false");
    const barberId = (await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Smart','Queue') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO barber_schedules(barber_id,day_of_week,start_time,end_time) SELECT $1, day, '00:00','23:59' FROM generate_series(0,6) AS day", [barberId]);
    const userId = (await db.query<{ id: number }>("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Queue','Guest','smart-queue@test.local','test',(SELECT id FROM roles WHERE name='customer')) RETURNING id")).rows[0].id;
    const customerId = (await db.query<{ id: number }>("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [userId])).rows[0].id;
    await db.query("INSERT INTO services(id,name,current_price,duration_minutes,active) VALUES ('smart-long','Long',100,30,true),('smart-short','Short',100,10,true)");
    const long = await queue.addWalkIn(db, { customerId, serviceId: "smart-long" });
    const short = await queue.addWalkIn(db, { customerId, serviceId: "smart-short" });
    await db.query("UPDATE queue_entries SET joined_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [long.id]);
    await db.query("UPDATE queue_entries SET joined_at=NOW()-INTERVAL '1 hour' WHERE id=$1", [short.id]);
    assert.equal((await queue.getNextCustomer(db, barberId))?.id, long.id, "without an appointment, FIFO applies");

    const bookingId = Number((await db.query<{ id: number }>(`INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time)
      SELECT $1,$2,'smart-short','Short',100,10, local_start::date,local_start::time,(local_start + INTERVAL '10 minutes')::time
      FROM (SELECT (clock_timestamp() AT TIME ZONE 'Asia/Manila') + INTERVAL '20 minutes' AS local_start) slot RETURNING id`, [customerId, barberId])).rows[0].id);
    assert.equal((await queue.getNextCustomer(db, barberId))?.id, short.id, "a later short service can fit before the appointment");
    await assert.rejects(queue.confirmNextCustomerAssignment(db, barberId, long.id), /Find the next customer again/);
    await queue.updateWalkInStatus(db, short.id, "removed");
    assert.equal(await queue.getNextCustomer(db, barberId), null, "return empty when every walk-in would overlap the appointment");
    const fitting = await queue.addWalkIn(db, { customerId, serviceId: "smart-short" });
    assert.equal((await queue.confirmNextCustomerAssignment(db, barberId, fitting.id)).status, "ready");
    assert.equal((await queue.findQueueEntry(db, fitting.id))?.startedAt, null);

    assert.equal((await updateBooking(db, bookingId, { status: "checked_in" }))?.status, "checked_in");
    assert.equal((await queue.getNextCustomer(db, barberId))?.bookingId, bookingId, "checked-in appointment has priority");
    assert.equal((await updateBooking(db, bookingId, { status: "cancelled", reason: "Customer left" }))?.status, "cancelled");
    await queue.updateWalkInStatus(db, fitting.id, "removed");
    assert.equal((await queue.getNextCustomer(db, barberId))?.id, long.id);

    await db.query("INSERT INTO barber_unavailability(barber_id,starts_at,ends_at,reason) VALUES ($1,NOW()+INTERVAL '5 minutes',NOW()+INTERVAL '20 minutes','Test absence')", [barberId]);
    assert.equal(await queue.getNextCustomer(db, barberId), null, "future unavailability blocks the service interval");
    await assert.rejects(queue.confirmNextCustomerAssignment(db, barberId, long.id), /Find the next customer again/);
    await db.query("DELETE FROM barber_unavailability WHERE barber_id=$1", [barberId]);
    await queue.updateWalkInStatus(db, long.id, "removed");
    assert.equal(await queue.getNextCustomer(db, barberId), null, "no safe customer is a clear empty result");

    const { canStartServiceNow } = await import("@/server/services/booking-availability.service");
    const tomorrow = new Date(Date.now() + 86_400_000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(tomorrow).map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const atTenTen = new Date(`${date}T10:10:00+08:00`);
    assert.equal(await canStartServiceNow(db, { serviceId: "smart-long", barberId }, atTenTen), true);
    const scheduleId = (await db.query<{ id: number }>("SELECT id FROM barber_schedules WHERE barber_id=$1 AND day_of_week=$2", [barberId, weekday])).rows[0].id;
    await db.query("INSERT INTO barber_schedule_breaks(barber_schedule_id,start_time,end_time) VALUES($1,'10:15','10:30')", [scheduleId]);
    assert.equal(await canStartServiceNow(db, { serviceId: "smart-short", barberId }, atTenTen), false, "a future break blocks an otherwise fitting service");
    await db.query("DELETE FROM barber_schedule_breaks WHERE barber_schedule_id=$1", [scheduleId]);
    await db.query("UPDATE barber_schedules SET end_time='10:15' WHERE id=$1", [scheduleId]);
    assert.equal(await canStartServiceNow(db, { serviceId: "smart-short", barberId }, atTenTen), false, "service must finish within shift");
    await db.query("UPDATE barber_schedules SET end_time='23:59' WHERE id=$1", [scheduleId]);
    await db.query("UPDATE shop_operating_hours SET close_time='10:15' WHERE day_of_week=$1", [weekday]);
    assert.equal(await canStartServiceNow(db, { serviceId: "smart-short", barberId }, atTenTen), false, "service must finish within shop hours");
  } finally { await cleanup(); }
});
