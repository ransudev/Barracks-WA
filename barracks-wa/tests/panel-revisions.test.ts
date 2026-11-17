import assert from "node:assert/strict";
import test from "node:test";
import { bookingDeposit, lateLabel, minutesLate } from "@/app/constants/booking";
import { bookingUpdateSchema, customerSelfSignupSchema } from "@/server/schemas/sprint.schema";
import { financialActionSchema } from "@/server/schemas/payment.schema";
import { describeTimes } from "@/server/services/booking-availability.service";
import { createBarber, updateBarberStatus } from "@/server/services/barber.service";
import { createBooking, listBookingEvents, updateBooking, updateBookingRemarks } from "@/server/services/booking.service";
import { applyFinancialAction, checkoutVisits, listEligibleVisits, voidVisitBalance } from "@/server/services/payment.service";
import { listQueue } from "@/server/services/queue.service";
import { barberScheduleLocks } from "@/server/services/record-locks";
import { addBarberUnavailability, listBarberSchedules, saveBarberSchedule, saveShopHours, listShopHours } from "@/server/services/schedule.service";
import { updateService } from "@/server/services/service.service";
import { createSession, findUserBySessionToken, touchSession } from "@/server/services/session.service";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

const date = "2026-10-05";
const now = new Date("2026-10-04T00:00:00Z");
const hours = { dayOfWeek: 1, openTime: "09:00", closeTime: "19:30", isClosed: false };
const schedule = { dayOfWeek: 1, isWorking: true, startTime: "09:00", endTime: "19:30", breaks: [] as { startTime: string; endTime: string }[] };
const reasons = (booked: { start: number; end: number }[], durationMinutes = 45) =>
  Object.fromEntries(describeTimes({ date, durationMinutes, hours, schedule, booked, now })
    .map((slot) => [slot.startTime, slot.available ? "open" : slot.reason]));

test("A1/A2: a booking occupies its own time, and a gap that is too short reads Not enough time", () => {
  // A 45-minute service booked at 9:15 runs 9:15-10:00. It does not take 9:00.
  const afterBooking = reasons([{ start: 9 * 60 + 15, end: 10 * 60 }]);
  assert.equal(afterBooking["09:00"], "not_enough_time");
  assert.deepEqual([afterBooking["09:15"], afterBooking["09:30"], afterBooking["09:45"]], ["booked", "booked", "booked"]);
  assert.equal(afterBooking["10:00"], "open");
  // Previous service ends 9:30, next starts 10:00: 9:45 is free but 45 minutes cannot fit.
  const gap = reasons([{ start: 9 * 60, end: 9 * 60 + 30 }, { start: 10 * 60, end: 10 * 60 + 30 }]);
  assert.equal(gap["09:30"], "not_enough_time");
  assert.equal(gap["09:45"], "not_enough_time");
  assert.equal(gap["10:30"], "open");
  // A 30-minute service does fit that gap.
  assert.equal(reasons([{ start: 9 * 60, end: 9 * 60 + 30 }, { start: 10 * 60, end: 10 * 60 + 30 }], 30)["09:30"], "open");
  // The last starts of the day are listed and explained, not hidden.
  assert.equal(reasons([])["19:00"], "not_enough_time");
});

test("A7/A13/A14/A16/A24: request rules", () => {
  const signup = { firstName: "Ana", lastName: "Cruz", email: "ana@example.com", password: "password123", phone: "" };
  assert.equal(customerSelfSignupSchema.safeParse({ ...signup, confirmPassword: "password123" }).success, true);
  assert.equal(customerSelfSignupSchema.safeParse({ ...signup, confirmPassword: "password124" }).success, false);
  assert.equal(customerSelfSignupSchema.safeParse(signup).success, false);
  assert.equal(bookingUpdateSchema.safeParse({ status: "rejected", reason: "Barber unavailable" }).success, true);
  assert.equal(bookingDeposit(300), 150);
  assert.equal(bookingDeposit(425), 213);
  assert.equal(bookingDeposit(0), 0);
  // Flagged only once more than 10 minutes late.
  assert.equal(minutesLate("2026-10-05", "09:00", new Date("2026-10-05T01:10:00Z")), 0);
  assert.equal(minutesLate("2026-10-05", "09:00", new Date("2026-10-05T01:11:00Z")), 11);
  assert.equal(lateLabel(11), "Late 11 min");
  assert.equal(lateLabel(125), "Late 2 h 5 min");
  assert.equal(financialActionSchema.safeParse({ action: "refund", amount: 300, reason: "Requested" }).success, false);
  assert.equal(financialActionSchema.safeParse({ action: "void", amount: 300, reason: "Requested" }).success, true);
});

async function fixture(db: import("pg").Pool) {
  const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
  const barber = await createBarber(db, { branchId: main, firstName: "Panel", lastName: "Barber", status: "available" });
  const staff = async (role: string) => Number((await db.query(
    `INSERT INTO users(first_name,last_name,email,password_hash,role_id,is_verified)
     VALUES($1::text,'Staff',$2,'hash',(SELECT id FROM roles WHERE name=$1::text),TRUE) RETURNING id`, [role, `${role}@panel.test`])).rows[0].id);
  const manager = await staff("manager"), frontDesk = await staff("front_desk");
  for (const user of [manager, frontDesk]) await db.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,TRUE)", [user, main]);
  const customers: number[] = [];
  for (const index of [0, 1, 2]) {
    const user = await db.query<{ id: number }>(`INSERT INTO users(first_name,last_name,email,password_hash,role_id)
      VALUES('Panel',$2,$1,'test',(SELECT id FROM roles WHERE name='customer')) RETURNING id`, [`panel-${index}@test.local`, `Customer${index}`]);
    customers.push(Number((await db.query("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [user.rows[0].id])).rows[0].id));
  }
  return { main, barber, manager, frontDesk, customers };
}

test("A4/A13/A14/A15/A17/A18/A19: booking events, deposit, reasons, remarks and locks", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(Infinity, "2026-10-12T02:00:00Z");
  try {
    const { main, barber, customers } = await fixture(db);
    const day = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const actor = { id: 1, name: "Front Desk" };

    // A customer request: one creation event, deposit reported and awaiting verification.
    const request = await createBooking(db, { customerId: customers[0], barberId: barber.id, serviceId: "barracks-basic", date: day, time: "09:15",
      status: "pending", deposit: { method: "e_wallet", reference: "GC-1" }, actor });
    assert.deepEqual([request.time, request.endTime], ["09:15", "10:00"]);
    assert.deepEqual([request.depositAmount, request.depositStatus, request.depositReference], [150, "submitted", "GC-1"]);
    assert.deepEqual((await listBookingEvents(db, request.id)).map((event) => [event.type, event.actorName]), [["created", "Front Desk"]]);
    await assert.rejects(db.query("INSERT INTO booking_events(booking_id,event_type) VALUES($1,'created')", [request.id]),
      { code: "23505", constraint: "booking_events_one_created" });

    // The slot before the booking is not taken; it simply cannot fit the service.
    await assert.rejects(createBooking(db, { customerId: customers[1], barberId: barber.id, serviceId: "barracks-basic", date: day, time: "09:00" }),
      (error: unknown) => error instanceof Error && /^Not enough time/.test(error.message));

    // Confirming verifies the deposit; each action logs exactly one event.
    const confirmed = await updateBooking(db, request.id, { status: "confirmed" });
    assert.equal(confirmed?.depositStatus, "received");

    // Locks: the service, the barber's shift for that weekday, the shop hours and time away.
    await assert.rejects(updateService(db, "barracks-basic", { price: 999 }), { code: "RECORD_LOCKED" });
    assert.deepEqual(await barberScheduleLocks(db, barber.id), { [weekday]: 1 });
    const shift = (await listBarberSchedules(db, barber.id)).find((item) => item.dayOfWeek === weekday)!;
    await assert.rejects(saveBarberSchedule(db, barber.id, { ...shift, endTime: "17:00" }), { code: "RECORD_LOCKED" });
    assert.equal((await saveBarberSchedule(db, barber.id, shift)).length, 7, "saving an unchanged shift is not an edit");
    const otherDay = (await listBarberSchedules(db, barber.id)).find((item) => item.dayOfWeek !== weekday && item.isWorking)!;
    await saveBarberSchedule(db, barber.id, { ...otherDay, endTime: "17:00" });
    const dayHours = (await listShopHours(db, main)).find((item) => item.dayOfWeek === weekday)!;
    await assert.rejects(saveShopHours(db, { ...dayHours, closeTime: "15:00" }, main), { code: "RECORD_LOCKED" });
    await assert.rejects(addBarberUnavailability(db, barber.id, { startsAt: `${day}T09:00:00+08:00`, endsAt: `${day}T12:00:00+08:00`, reason: "Leave" }), { code: "RECORD_LOCKED" });
    await assert.rejects(updateBarberStatus(db, barber.id, "unavailable"), { code: "RECORD_LOCKED" });

    // Rejecting or cancelling as the shop requires a reason, which is stored for the customer.
    const second = await createBooking(db, { customerId: customers[1], barberId: barber.id, serviceId: "signature-shave", date: day, time: "11:00",
      status: "pending", deposit: { method: "bank_transfer", reference: "BT-2" } });
    await assert.rejects(updateBooking(db, second.id, { status: "rejected" }), { kind: "not_updatable" });
    const rejected = await updateBooking(db, second.id, { status: "rejected", reason: "Deposit not found" });
    assert.deepEqual([rejected?.status, rejected?.statusReason, rejected?.closedBy, rejected?.depositStatus], ["rejected", "Deposit not found", "shop", "released"]);
    await assert.rejects(updateBooking(db, request.id, { status: "cancelled" }), { kind: "not_updatable" });
    const cancelled = await updateBooking(db, request.id, { status: "cancelled", reason: "Barber on leave" });
    assert.deepEqual([cancelled?.statusReason, cancelled?.closedBy], ["Barber on leave", "shop"]);

    // Remarks appear on the booking and are logged.
    assert.equal((await updateBookingRemarks(db, request.id, "  Offered a new time  ", actor))?.remarks, "Offered a new time");
    assert.deepEqual((await listBookingEvents(db, request.id)).map((event) => event.type), ["created", "confirmed", "cancelled", "remarks"]);

    // With its bookings closed, everything unlocks.
    assert.deepEqual(await barberScheduleLocks(db, barber.id), {});
    assert.equal((await updateService(db, "barracks-basic", { inclusions: ["Haircut", "Hot towel"] }))?.inclusions.length, 2);
    await saveBarberSchedule(db, barber.id, { ...shift, endTime: "17:00" });
    assert.equal((await updateBarberStatus(db, barber.id, "unavailable"))?.status, "unavailable");
  } finally { await cleanup(); }
});

test("A20/A21/A23/A24/A26: balances, underpayment, void and one receipt for several services", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  try {
    const { main, barber, manager, frontDesk, customers } = await fixture(db);
    const walkIn = async (customer: number, service: string) => Number((await db.query(
      `INSERT INTO queue_entries(customer_id,service_id,barber_id,service_name_snapshot,service_price_snapshot,status,branch_id,started_at,completed_at)
       VALUES($1,$2,$3,'x',0,'completed',$4,now()-interval '30 minutes',now()) RETURNING id`, [customer, service, barber.id, main])).rows[0].id);
    const booking = Number((await db.query(
      `INSERT INTO bookings(branch_id,customer_id,barber_id,service_id,service_name,service_price,service_duration_minutes,booking_date,booking_time,status,deposit_amount,deposit_method,deposit_status)
       VALUES($1,$2,$3,'barracks-basic','Barracks Basic',300,45,'2026-09-20','10:00','completed',150,'cash','received') RETURNING id`, [main, customers[0], barber.id])).rows[0].id);
    const balances = async () => Object.fromEntries((await listEligibleVisits(db, [main])).map((visit) => [`${visit.visitType}:${visit.visitRecordId}`, [visit.paid, visit.balance]]));

    // The verified deposit already counts toward the booking.
    assert.deepEqual((await balances())[`booking:${booking}`], [150, 150]);

    // Underpayment: recorded, balance shown, and the visit is not marked as paid.
    const partial = await checkoutVisits(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 100 }, frontDesk);
    assert.deepEqual(partial, { kind: "partial", customerName: "Panel Customer0", serviceName: "Barracks Basic", received: 100, paid: 250, total: 300, balance: 50 });
    assert.deepEqual((await balances())[`booking:${booking}`], [250, 50]);
    assert.equal(Number((await db.query("SELECT count(*) FROM transactions")).rows[0].count), 0);
    await assert.rejects(db.query("UPDATE visit_partial_payments SET amount=1"), { constraint: "partial_payment_immutable" });

    // Settling the balance completes the sale for the full price.
    const settled = await checkoutVisits(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 100 }, frontDesk);
    assert.equal(settled.kind, "paid");
    if (settled.kind !== "paid") return;
    assert.deepEqual([settled.transaction.total, settled.transaction.priorPaid, settled.transaction.tendered, settled.transaction.change], [300, 250, 100, 50]);
    assert.equal((await balances())[`booking:${booking}`], undefined);

    // Several services of one customer share one receipt; different customers cannot.
    const first = await walkIn(customers[1], "barracks-basic"), second = await walkIn(customers[1], "signature-shave");
    const stranger = await walkIn(customers[2], "barracks-premium");
    await assert.rejects(checkoutVisits(db, { visits: [{ queueEntryId: first }, { queueEntryId: stranger }], paymentMethod: "card" }, frontDesk), { kind: "invalid_state" });
    await assert.rejects(checkoutVisits(db, { visits: [{ queueEntryId: first }, { queueEntryId: second }], paymentMethod: "cash", amountReceived: 500 }, frontDesk), { kind: "insufficient_cash" });
    const group = await checkoutVisits(db, { visits: [{ queueEntryId: first }, { queueEntryId: second }], paymentMethod: "cash", amountReceived: 1000 }, frontDesk);
    assert.equal(group.kind, "paid");
    if (group.kind !== "paid") return;
    assert.match(group.transaction.receiptGroup ?? "", /^RC-/);
    assert.deepEqual(group.transaction.lines?.map((line) => [line.serviceName, line.amount]), [["Barracks Basic", 300], ["Signature Shave", 300]]);
    assert.deepEqual([group.transaction.receiptTotal, group.transaction.receiptTendered, group.transaction.receiptChange], [600, 1000, 400]);
    assert.equal(group.transaction.business?.name, "Main Branch");

    // Manager-only void of an unpaid balance, with a required reason; what was collected becomes the sale.
    await checkoutVisits(db, { visit: { queueEntryId: stranger }, paymentMethod: "e_wallet", amountReceived: 300 }, frontDesk);
    await assert.rejects(voidVisitBalance(db, { queueEntryId: stranger }, "Special price", frontDesk), { kind: "forbidden" });
    const voided = await voidVisitBalance(db, { queueEntryId: stranger }, "Special price", manager);
    assert.deepEqual([voided.amountDue, voided.amountPaid, voided.voidedAmount, voided.reason], [550, 300, 250, "Special price"]);
    assert.equal(Number((await db.query("SELECT amount FROM transactions WHERE reference=$1", [voided.reference])).rows[0].amount), 300);
    await assert.rejects(voidVisitBalance(db, { queueEntryId: stranger }, "Again", manager), { kind: "conflict" });
    await assert.rejects(db.query("DELETE FROM visit_voids"), { constraint: "visit_void_immutable" });

    // A paid sale can be voided by management even though commission was earned.
    await assert.rejects(applyFinancialAction(db, settled.transaction.reference, { action: "void", amount: 300, reason: "Wrong visit" }, frontDesk), { kind: "forbidden" });
    assert.equal((await applyFinancialAction(db, settled.transaction.reference, { action: "void", amount: 300, reason: "Wrong visit" }, manager)).status, "voided");

    // Completed Today shows whether each customer has paid.
    const paid = Object.fromEntries((await listQueue(db, "completed-today", main)).map((entry) => [entry.id, entry.paymentStatus]));
    assert.deepEqual([paid[first], paid[second], paid[stranger]], ["paid", "paid", "voided"]);
  } finally { await cleanup(); }
});

test("A6: a session ends after 30 minutes without activity", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  try {
    const user = Number((await db.query(`INSERT INTO users(first_name,last_name,email,password_hash,role_id,is_verified)
      VALUES('Idle','User','idle@panel.test','hash',(SELECT id FROM roles WHERE name='manager'),TRUE) RETURNING id`)).rows[0].id);
    const { token, expiresAt } = await createSession(db, user);
    assert.ok(Math.abs(expiresAt.getTime() - Date.now() - 30 * 60_000) < 5_000);
    const remaining = async () => Number((await db.query("SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) AS seconds FROM sessions")).rows[0].seconds);
    // Twenty idle minutes leave ten; fresh activity restores the full thirty.
    await touchSession(db, token, 20 * 60);
    assert.ok(Math.abs(await remaining() - 10 * 60) < 5);
    await touchSession(db, token, 0);
    assert.ok(Math.abs(await remaining() - 30 * 60) < 5);
    assert.equal((await findUserBySessionToken(db, token))?.id, user);
    // Thirty idle minutes end it, and an expired session cannot be revived.
    await touchSession(db, token, 30 * 60);
    assert.equal(await findUserBySessionToken(db, token), null);
    await touchSession(db, token, 0);
    assert.equal(await findUserBySessionToken(db, token), null);
  } finally { await cleanup(); }
});
