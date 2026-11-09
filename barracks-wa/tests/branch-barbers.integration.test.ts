import assert from "node:assert/strict";
import { test } from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { applyMigrations } from "@/server/db/migrate";
import { createBarber, findBarberById, listBarbers, updateBarber } from "@/server/services/barber.service";
import { listBarberSchedules, listShopHours, saveBarberSchedule, saveShopHours } from "@/server/services/schedule.service";
import { getBookingAvailability, getAnyBarberAvailability } from "@/server/services/booking-availability.service";
import { getBarberOperationalAvailability } from "@/server/services/barber-operational-availability.service";
import { barberStaffSchema } from "@/server/schemas/sprint.schema";

test("Phase 2 backfills ownership without changing Main hours or existing schedules", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(22);
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const barber = Number((await db.query("INSERT INTO barbers(first_name,last_name) VALUES('Legacy','Branch') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO barber_schedules(barber_id,day_of_week,start_time,end_time) VALUES($1,1,'11:00','15:00')", [barber]);
    await db.query("UPDATE shop_operating_hours SET open_time='10:00',close_time='17:00',is_closed=true WHERE day_of_week=0");
    const before = await listBarberSchedules(db, barber);
    await db.query("INSERT INTO branches(name,code) VALUES('Existing second','SECOND')");
    await applyMigrations(db);
    await applyMigrations(db);
    assert.equal((await findBarberById(db, barber))?.branchId, main);
    assert.deepEqual(await listBarberSchedules(db, barber), before);
    assert.deepEqual((await listShopHours(db, main))[0], { dayOfWeek: 0, openTime: "10:00", closeTime: "17:00", isClosed: true });
    assert.equal((await db.query("SELECT count(*) FROM shop_operating_hours")).rows[0].count, "14");
    await assert.rejects(db.query("UPDATE barbers SET branch_id=NULL WHERE id=$1", [barber]), (error: unknown) => (error as { code: string }).code === "23502");
  } finally { await cleanup(); }
});

test("branch hours initialize barbers and drive availability; safe moves preserve schedules", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Second','SECOND') RETURNING id")).rows[0].id);
    assert.equal((await listShopHours(db, second)).length, 7);
    await db.query("UPDATE shop_operating_hours SET open_time='12:00',close_time='16:00' WHERE branch_id=$1", [second]);
    await saveShopHours(db, { dayOfWeek: 0, openTime: "12:00", closeTime: "16:00", isClosed: true }, second);
    assert.equal((await listShopHours(db, main))[0].isClosed, false);
    assert.equal(barberStaffSchema.safeParse({ firstName: "A", lastName: "B", status: "available" }).success, false);
    await assert.rejects(createBarber(db, { branchId: 2147483647, firstName: "Invalid", lastName: "Branch", status: "available" }), (error: unknown) => (error as { code: string }).code === "23503");
    const barber = await createBarber(db, { branchId: second, firstName: "Second", lastName: "Barber", status: "available" });
    const shifts = await listBarberSchedules(db, barber.id);
    assert.equal(shifts.length, 7); assert.equal(shifts[0].isWorking, false);
    assert.equal(shifts[1].startTime, "12:00"); assert.equal(shifts[1].endTime, "16:00");
    await assert.rejects(saveBarberSchedule(db, barber.id, { dayOfWeek: 1, isWorking: true, startTime: "09:00", endTime: "19:00", breaks: [] }), /branch operating hours/);
    const input = { serviceId: "barracks-basic", barberId: barber.id, date: "2099-10-05" };
    const result = await getBookingAvailability(db, input, { now: new Date("2099-10-04T00:00:00Z") });
    assert.equal(result.slots[0]?.startTime, "12:00");
    assert.equal((await getAnyBarberAvailability(db, input, { now: new Date("2099-10-04T00:00:00Z") })).slots[0]?.startTime, "12:00");
    await db.query("UPDATE shop_operating_hours SET is_closed=true WHERE branch_id=$1", [main]);
    assert.equal((await getBookingAvailability(db, input, { now: new Date("2099-10-04T00:00:00Z") })).slots[0]?.startTime, "12:00");
    // Operational availability must likewise use the owning branch, at DB time.
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false WHERE branch_id=$1", [second]);
    await db.query("UPDATE barber_schedules SET start_time='00:00',end_time='23:59',is_working=true WHERE barber_id=$1", [barber.id]);
    assert.equal((await getBarberOperationalAvailability(db, barber.id)).available, true);
    await assert.rejects(updateBarber(db, barber.id, { branchId: main, firstName: "Second", lastName: "Barber", status: "available" }), /destination branch hours/);
    assert.equal((await findBarberById(db, barber.id))?.branchId, second);
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false WHERE branch_id=$1", [main]);
    await db.query("UPDATE shop_operating_hours SET is_closed=true WHERE branch_id=$1", [second]);
    assert.equal((await getBarberOperationalAvailability(db, barber.id)).available, false);
    await db.query("UPDATE shop_operating_hours SET is_closed=false WHERE branch_id=$1", [second]);
    const beforeMove = await listBarberSchedules(db, barber.id);
    assert.equal((await updateBarber(db, barber.id, { branchId: main, firstName: "Second", lastName: "Barber", status: "available" }))?.branchId, main);
    assert.deepEqual(await listBarberSchedules(db, barber.id), beforeMove);
    await db.query("INSERT INTO customers(first_name,last_name) VALUES('Active','Customer')");
    await db.query("INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status) VALUES((SELECT id FROM customers LIMIT 1),$1,'barracks-basic','Cut',100,'2099-10-05','12:00','confirmed')", [barber.id]);
    await assert.rejects(updateBarber(db, barber.id, { branchId: second, firstName: "Second", lastName: "Barber", status: "available" }), /active bookings/);
    await db.query("UPDATE bookings SET status='cancelled' WHERE barber_id=$1", [barber.id]);
    await db.query("INSERT INTO queue_entries(customer_id,barber_id,service_id,status) VALUES((SELECT id FROM customers LIMIT 1),$1,'barracks-basic','ready')", [barber.id]);
    await assert.rejects(updateBarber(db, barber.id, { branchId: second, firstName: "Second", lastName: "Barber", status: "available" }), /active bookings and queue/);
  } finally { await cleanup(); }
});

test("a pending booking request blocks a barber branch move until it is resolved", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Pending destination','PENDING') RETURNING id")).rows[0].id);
    // Make the destination hours wide enough that only the booking can block the move.
    await db.query("UPDATE shop_operating_hours SET open_time='00:00',close_time='23:59',is_closed=false WHERE branch_id=$1", [second]);
    const barber = await createBarber(db, { branchId: main, firstName: "Pending", lastName: "Barber", status: "available" });
    const customer = Number((await db.query("INSERT INTO customers(first_name,last_name) VALUES('Pending','Customer') RETURNING id")).rows[0].id);
    const booking = Number((await db.query(`INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time,status,branch_id)
      VALUES($1,$2,'barracks-basic','Cut',100,30,'2099-10-05','12:00','12:30','pending',$3) RETURNING id`, [customer, barber.id, main])).rows[0].id);
    const move = () => updateBarber(db, barber.id, { branchId: second, firstName: "Pending", lastName: "Barber", status: "available" });
    await assert.rejects(move(), /active bookings/);
    assert.equal((await findBarberById(db, barber.id))?.branchId, main);
    await db.query("UPDATE bookings SET status='rejected' WHERE id=$1", [booking]);
    assert.equal((await move())?.branchId, second);
  } finally { await cleanup(); }
});

test("barber roster metrics use branch-owned history after a move and retain portable counters untouched", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Metrics destination','METRICS') RETURNING id")).rows[0].id);
    const barber = await createBarber(db, { branchId: main, firstName: "History", lastName: "Barber", status: "available" });
    await db.query("UPDATE barbers SET services_done=12,revenue=840 WHERE id=$1", [barber.id]);
    const customer = Number((await db.query("INSERT INTO customers(first_name,last_name) VALUES('History','Customer') RETURNING id")).rows[0].id);
    const booking = Number((await db.query(`INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,end_time,status,branch_id)
      VALUES($1,$2,'barracks-basic','Saved cut',300,30,'2026-09-01','10:00','10:30','completed',$3) RETURNING id`, [customer, barber.id, main])).rows[0].id);
    await db.query("BEGIN");
    const transaction = Number((await db.query(`INSERT INTO transactions(branch_id,booking_id,barber_id,amount,status,visit_type,visit_record_id,customer_name,barber_name,service_name,payment_method)
      VALUES($1,$2,$3,300,'completed','booking',$2,'History Customer','History Barber','Saved cut','card') RETURNING id`, [main, booking, barber.id])).rows[0].id);
    await db.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status) VALUES($1,'card',300,'completed')", [transaction]);
    await db.query("COMMIT");
    assert.equal((await updateBarber(db, barber.id, { branchId: second, firstName: "History", lastName: "Barber", status: "available" }))?.branchId, second);
    const destination = (await listBarbers(db, [second]))[0];
    assert.equal(destination.servicesDone, 0);
    assert.equal(destination.revenue, 0);
    const stored = (await db.query("SELECT services_done,revenue FROM barbers WHERE id=$1", [barber.id])).rows[0];
    assert.equal(stored.services_done, 12);
    assert.equal(Number(stored.revenue), 840);
  } finally { await cleanup(); }
});
