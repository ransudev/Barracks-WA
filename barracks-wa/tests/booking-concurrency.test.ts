import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

test("PostgreSQL rejects overlapping barber and customer bookings under concurrent writes", { skip: !databaseConfigured }, async () => {
  const { db: pool, cleanup } = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z");
  const { createBooking, updateBooking, BookingServiceError } = await import("@/server/services/booking.service");
  const { mayMarkNoShow } = await import("@/app/constants/booking");
  const queue = await import("@/server/services/queue.service");
  const tag = randomUUID().slice(0, 8);
  const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const users: number[] = [];
  const barbers: number[] = [];
  const serviceId = `test-${tag}`;
  const longServiceId = `long-${tag}`;
  try {
    await pool.query("INSERT INTO services(id,name,current_price,duration_minutes,active) VALUES($1,'Concurrency cut',100,45,true)", [serviceId]);
    await pool.query("INSERT INTO services(id,name,current_price,duration_minutes,active) VALUES($1,'Long cut',100,90,true)", [longServiceId]);
    for (let i = 0; i < 2; i++) {
      const user = await pool.query<{ id: number }>("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Race','Test',$1,'test',(SELECT id FROM roles WHERE name='customer')) RETURNING id", [`race-${tag}-${i}@test.local`]);
      users.push(user.rows[0].id);
      const barber = await pool.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Race','Barber') RETURNING id");
      barbers.push(barber.rows[0].id);
      await pool.query("INSERT INTO barber_schedules(barber_id,day_of_week,start_time,end_time) SELECT $1, day, '09:00','19:30' FROM generate_series(0,6) AS day", [barber.rows[0].id]);
    }
    const customers = await Promise.all(users.map(async (userId) => (await pool.query<{ id: number }>("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [userId])).rows[0].id));
    const request = (customerId: number, barberId: number, time: string) => createBooking(pool, { customerId, barberId, serviceId, date, time });
    const race = await Promise.allSettled([request(customers[0], barbers[0], "10:00"), request(customers[1], barbers[0], "10:00")]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1, race.map((result) => result.status === "rejected" ? String(result.reason) : "success").join("; "));
    assert.equal(race.filter((result) => result.status === "rejected" && result.reason instanceof BookingServiceError && result.reason.kind === "conflict").length, 1);
    const winner = (race.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ customerId: number }>).value;
    const loser = customers.find((id) => id !== winner.customerId)!;
    await assert.rejects(request(loser, barbers[0], "09:45"), { kind: "conflict" });
    await assert.rejects(request(loser, barbers[0], "10:15"), { kind: "conflict" });
    await assert.rejects(request(loser, barbers[0], "09:30"), { kind: "conflict" });
    await assert.rejects(createBooking(pool, { customerId: loser, barberId: barbers[0], serviceId: longServiceId, date, time: "09:15" }), { kind: "conflict" });
    await assert.rejects(request(winner.customerId, barbers[1], "10:15"), { kind: "conflict" });
    const adjacent = await request(loser, barbers[0], "10:45");
    assert.equal(adjacent.time, "10:45");
    const any = await createBooking(pool, { customerId: loser, serviceId, date, time: "10:00" });
    assert.notEqual(any.barberId, barbers[0]);
    await assert.rejects(createBooking(pool, { customerId: winner.customerId, serviceId, date, time: "10:15" }), { kind: "conflict" });
    await assert.rejects(createBooking(pool, { customerId: winner.customerId, serviceId, date, time: "19:15" }), { kind: "conflict" });
    const direct = (customerId: number, index: number) => pool.query(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time)
       VALUES($1,$2,$3,'Concurrency cut',100,45,$4,$5,$6)`,
      [customerId, barbers[0], serviceId, date, index ? "12:15" : "12:00", index ? "13:00" : "12:45"],
    );
    const databaseRace = await Promise.allSettled(customers.map(direct));
    assert.equal(databaseRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(databaseRace.filter((result) => result.status === "rejected" && result.reason.code === "23P01").length, 1,
      databaseRace.map((result) => result.status === "rejected" ? `${result.reason.code}: ${result.reason.message}` : "success").join("; "));
    assert.equal(mayMarkNoShow("2026-10-05", "10:00", new Date("2026-10-05T02:09:00Z")), false);
    assert.equal(mayMarkNoShow("2026-10-05", "10:00", new Date("2026-10-05T02:10:00Z")), true);
    // Queue operations validate the real current Manila shift, independent of
    // the future booking slots exercised above.
    await pool.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false");
    await pool.query("UPDATE barber_schedules SET start_time='00:00',end_time='23:59'");
    await assert.rejects(updateBooking(pool, adjacent.id, { status: "completed" }), { kind: "not_updatable" });
    assert.equal((await updateBooking(pool, adjacent.id, { status: "checked_in" }))?.status, "checked_in");
    assert.equal((await queue.listQueue(pool)).filter((entry) => entry.bookingId === adjacent.id && entry.status === "ready").length, 1);
    await assert.rejects(updateBooking(pool, adjacent.id, { status: "checked_in" }), { kind: "not_updatable" });
    assert.equal((await queue.listQueue(pool)).filter((entry) => entry.bookingId === adjacent.id).length, 1);
    assert.equal((await updateBooking(pool, adjacent.id, { status: "in_progress" }))?.status, "in_progress");
    assert.equal((await queue.listQueue(pool)).find((entry) => entry.bookingId === adjacent.id)?.status, "in_progress");
    assert.equal((await updateBooking(pool, adjacent.id, { status: "completed" }))?.status, "completed");
    assert.equal((await queue.listQueue(pool)).some((entry) => entry.bookingId === adjacent.id), false);
    assert.equal((await queue.listQueue(pool, "completed-today")).find((entry) => entry.bookingId === adjacent.id)?.status, "completed");
    await assert.rejects(updateBooking(pool, adjacent.id, { status: "cancelled", reason: "Shop closed" }), { kind: "not_updatable" });
    const walkIn = await queue.addWalkIn(pool, { customerId: loser, serviceId });
    assert.equal(walkIn.bookingId, null);
    assert.equal(walkIn.status, "waiting");
    assert.equal((await queue.findQueueEntry(pool, walkIn.id))?.status, "waiting");
    assert.equal((await queue.assignQueueBarber(pool, walkIn.id, barbers[1])).status, "ready");
    assert.equal((await queue.updateWalkInStatus(pool, walkIn.id, "in_progress")).status, "in_progress");
    assert.equal((await queue.updateWalkInStatus(pool, walkIn.id, "completed")).status, "completed");
    assert.equal((await queue.findQueueEntry(pool, walkIn.id))?.status, "completed");
    const removable = await queue.addWalkIn(pool, { customerId: winner.customerId, serviceId });
    assert.equal((await queue.updateWalkInStatus(pool, removable.id, "removed")).status, "removed");
    assert.equal((await queue.listQueue(pool)).some((entry) => entry.id === removable.id), false);
    const cancelled = await request(loser, barbers[1], "14:00");
    assert.equal((await updateBooking(pool, cancelled.id, { status: "checked_in" }))?.status, "checked_in");
    assert.equal((await updateBooking(pool, cancelled.id, { status: "cancelled", reason: "Shop closed" }))?.status, "cancelled");
    assert.equal((await queue.findQueueEntry(pool, (await pool.query<{ id: number }>("SELECT id FROM queue_entries WHERE booking_id=$1", [cancelled.id])).rows[0].id))?.status, "removed");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const late = await pool.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time)
       VALUES($1,$2,$3,'Concurrency cut',100,45,$4,'10:00','10:45') RETURNING id`,
      [customers[0], barbers[1], serviceId, yesterday],
    );
    assert.equal((await updateBooking(pool, late.rows[0].id, { status: "no_show" }))?.status, "no_show");
    const graceBooking = async (customerId: number, barberId: number, age: string) => {
      const result = await pool.query<{ id: number }>(
        `WITH clock AS (SELECT NOW() AT TIME ZONE 'Asia/Manila' AS local_now)
         INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time)
         SELECT $1,$2,$3,'Concurrency cut',100,45,(local_now-$4::interval)::date,
                (local_now-$4::interval)::time,(local_now-$4::interval+INTERVAL '45 minutes')::time FROM clock RETURNING id`,
        [customerId, barberId, serviceId, age],
      );
      return result.rows[0].id;
    };
    const early = await graceBooking(customers[0], barbers[0], "9 minutes 30 seconds");
    const eligible = await graceBooking(customers[1], barbers[1], "10 minutes 30 seconds");
    await assert.rejects(updateBooking(pool, early, { status: "no_show" }), { kind: "not_updatable" });
    assert.equal((await updateBooking(pool, eligible, { status: "no_show" }))?.status, "no_show");
  } finally {
    await cleanup();
  }
});
