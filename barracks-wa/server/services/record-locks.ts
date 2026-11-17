import type { Db } from "@/server/db/transaction";

// A record that another live record depends on is locked: it cannot be edited
// or removed until those dependents finish. Every edit screen shares these
// checks so the rule is the same everywhere.
export class RecordLockedError extends Error {
  readonly code = "RECORD_LOCKED";
  constructor(message: string) {
    super(message);
    this.name = "RecordLockedError";
  }
}

// Bookings that still hold a slot or are being served. A pending or confirmed
// booking whose day has passed no longer holds anything, so it does not lock.
const TODAY = "(NOW() AT TIME ZONE 'Asia/Manila')::date";
export const ACTIVE_BOOKING = `(status IN ('checked_in','in_progress') OR (status IN ('pending','confirmed') AND booking_date >= ${TODAY}))`;
const UPCOMING = `status IN ('pending','confirmed','checked_in','in_progress') AND booking_date >= ${TODAY}`;
// Queue visits still on the floor; entries abandoned on an earlier day do not lock.
export const ACTIVE_QUEUE = "(status IN ('waiting','ready','in_progress') AND joined_at > NOW() - INTERVAL '1 day')";
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const verb = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

// Active bookings and live queue entries that use a service.
export async function countServiceDependents(db: Db, serviceId: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT ((SELECT count(*) FROM bookings WHERE service_id=$1 AND ${ACTIVE_BOOKING})
      + (SELECT count(*) FROM queue_entries WHERE service_id=$1 AND ${ACTIVE_QUEUE}))::int AS count`,
    [serviceId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function requireServiceUnlocked(db: Db, serviceId: string): Promise<void> {
  const count = await countServiceDependents(db, serviceId);
  if (count) throw new RecordLockedError(
    `This service is locked: ${count} active ${verb(count, "booking or queue visit uses", "bookings or queue visits use")} it. It can be edited once they are completed or cancelled.`);
}

// Upcoming active bookings per weekday (0 = Sunday) for one barber.
export async function barberScheduleLocks(db: Db, barberId: number): Promise<Record<number, number>> {
  const result = await db.query<{ day: number; count: number }>(
    `SELECT EXTRACT(DOW FROM booking_date)::int AS day, count(*)::int AS count
     FROM bookings WHERE barber_id=$1 AND ${UPCOMING} GROUP BY 1`, [barberId]);
  return Object.fromEntries(result.rows.map((row) => [row.day, row.count]));
}

export async function requireBarberDayUnlocked(db: Db, barberId: number, dayOfWeek: number): Promise<void> {
  const count = (await barberScheduleLocks(db, barberId))[dayOfWeek] ?? 0;
  if (count) throw new RecordLockedError(
    `This day's schedule is locked: ${plural(count, "upcoming booking")} ${verb(count, "depends", "depend")} on it. Move or cancel ${verb(count, "it", "them")} before changing the shift.`);
}

// Time away may not be placed over an appointment the barber already holds.
export async function requireNoBookingsInPeriod(db: Db, barberId: number, startsAt: string, endsAt: string): Promise<void> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM bookings WHERE barber_id=$1 AND ${ACTIVE_BOOKING}
       AND ((booking_date + booking_time) AT TIME ZONE 'Asia/Manila') < $3::timestamptz
       AND ((booking_date + booking_time + COALESCE(service_duration_minutes,0) * INTERVAL '1 minute') AT TIME ZONE 'Asia/Manila') > $2::timestamptz`,
    [barberId, startsAt, endsAt]);
  const count = result.rows[0]?.count ?? 0;
  if (count) throw new RecordLockedError(
    `This period is locked: ${plural(count, "booking")} ${verb(count, "falls", "fall")} inside it. Move or cancel ${verb(count, "it", "them")} before adding time away.`);
}

// Upcoming active bookings per weekday for a whole branch (shop hours).
export async function branchHoursLocks(db: Db, branchId: number): Promise<Record<number, number>> {
  const result = await db.query<{ day: number; count: number }>(
    `SELECT EXTRACT(DOW FROM booking_date)::int AS day, count(*)::int AS count
     FROM bookings WHERE branch_id=$1 AND ${UPCOMING} GROUP BY 1`, [branchId]);
  return Object.fromEntries(result.rows.map((row) => [row.day, row.count]));
}

export async function requireBranchDayUnlocked(db: Db, branchId: number, dayOfWeek: number): Promise<void> {
  const count = (await branchHoursLocks(db, branchId))[dayOfWeek] ?? 0;
  if (count) throw new RecordLockedError(
    `These hours are locked: ${plural(count, "upcoming booking")} ${verb(count, "depends", "depend")} on this day. Move or cancel ${verb(count, "it", "them")} before changing the hours.`);
}

export async function countBarberActiveBookings(db: Db, barberId: number): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT ((SELECT count(*) FROM bookings WHERE barber_id=$1 AND ${ACTIVE_BOOKING})
      + (SELECT count(*) FROM queue_entries WHERE barber_id=$1 AND ${ACTIVE_QUEUE}))::int AS count`, [barberId]);
  return result.rows[0]?.count ?? 0;
}

export async function countBranchActiveBookings(db: Db, branchId: number): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT ((SELECT count(*) FROM bookings WHERE branch_id=$1 AND ${ACTIVE_BOOKING})
      + (SELECT count(*) FROM queue_entries WHERE branch_id=$1 AND ${ACTIVE_QUEUE}))::int AS count`, [branchId]);
  return result.rows[0]?.count ?? 0;
}
