import { inTransaction, type Db } from "@/server/db/transaction";
import { BranchError } from "@/server/services/branch.service";
import type { z } from "zod";
import { hoursSchema, weeklyScheduleSchema, unavailabilitySchema } from "@/server/schemas/schedule.schema";
import { requireBarberDayUnlocked, requireBranchDayUnlocked, requireNoBookingsInPeriod } from "@/server/services/record-locks";

export type ShopHours = z.infer<typeof hoursSchema>;
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;
export type UnavailabilityInput = z.infer<typeof unavailabilitySchema>;
export type Unavailability = UnavailabilityInput & { id: number };


export class ShopHoursConfigurationError extends Error { constructor() { super("Shop hours contain multiple schedules for the same weekday in this branch."); } }

export async function listShopHours(db: Db, branchId: number): Promise<ShopHours[]> {
  const result = await db.query<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean }>(
    "SELECT day_of_week, open_time, close_time, is_closed FROM shop_operating_hours WHERE branch_id=$1 ORDER BY day_of_week", [branchId],
  );
  const weekdays = new Set(result.rows.map((row) => row.day_of_week));
  if (weekdays.size !== result.rows.length) throw new ShopHoursConfigurationError();
  return result.rows.map((row) => ({ dayOfWeek: row.day_of_week, openTime: row.open_time.slice(0, 5), closeTime: row.close_time.slice(0, 5), isClosed: row.is_closed }));
}

export async function saveShopHours(db: Db, input: ShopHours, branchId: number): Promise<ShopHours[]> {
  hoursSchema.parse(input);
  // Hours that upcoming bookings were made against are locked.
  const current = (await listShopHours(db, branchId)).find((day) => day.dayOfWeek === input.dayOfWeek);
  const changed = !current || current.isClosed !== input.isClosed || current.openTime !== input.openTime || current.closeTime !== input.closeTime;
  if (changed) await requireBranchDayUnlocked(db, branchId, input.dayOfWeek);
  await db.query("UPDATE shop_operating_hours SET open_time=$2, close_time=$3, is_closed=$4, updated_at=NOW() WHERE day_of_week=$1 AND branch_id=$5", [input.dayOfWeek, input.openTime, input.closeTime, input.isClosed, branchId]);
  return listShopHours(db, branchId);
}

export async function listBarberSchedules(db: Db, barberId: number): Promise<WeeklySchedule[]> {
  const schedules = await db.query<{ id: number; day_of_week: number; is_working: boolean; start_time: string; end_time: string }>(
    "SELECT id, day_of_week, is_working, start_time, end_time FROM barber_schedules WHERE barber_id=$1 ORDER BY day_of_week", [barberId],
  );
  const breaks = await db.query<{ barber_schedule_id: number; start_time: string; end_time: string }>(
    "SELECT b.barber_schedule_id, b.start_time, b.end_time FROM barber_schedule_breaks b JOIN barber_schedules s ON s.id=b.barber_schedule_id WHERE s.barber_id=$1 ORDER BY b.start_time", [barberId],
  );
  return schedules.rows.map((row) => ({ dayOfWeek: row.day_of_week, isWorking: row.is_working, startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5), breaks: breaks.rows.filter((item) => item.barber_schedule_id === row.id).map((item) => ({ startTime: item.start_time.slice(0, 5), endTime: item.end_time.slice(0, 5) })) }));
}

export async function saveBarberSchedule(db: Db, barberId: number, input: WeeklySchedule): Promise<WeeklySchedule[]> {
  weeklyScheduleSchema.parse(input);
  return inTransaction(db, async (client) => {
    const barber = await client.query<{ branch_id: number }>("SELECT branch_id FROM barbers WHERE id=$1 FOR UPDATE", [barberId]);
    if (!barber.rowCount) throw new Error("Barber not found");
    // A shift that upcoming bookings depend on is locked until they are moved or cancelled.
    const existing = (await listBarberSchedules(client, barberId)).find((day) => day.dayOfWeek === input.dayOfWeek);
    if (!existing || JSON.stringify(existing) !== JSON.stringify({ ...input, breaks: [...input.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
      await requireBarberDayUnlocked(client, barberId, input.dayOfWeek);
    const hours = (await listShopHours(client, barber.rows[0].branch_id)).find((day) => day.dayOfWeek === input.dayOfWeek);
    if (!hours || (input.isWorking && (hours.isClosed || input.startTime < hours.openTime || input.endTime > hours.closeTime)))
      throw new BranchError("Shift must fit the barber's branch operating hours", 400);
    const result = await client.query<{ id: number }>(`INSERT INTO barber_schedules (barber_id, day_of_week, is_working, start_time, end_time)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (barber_id,day_of_week) DO UPDATE SET is_working=$3,start_time=$4,end_time=$5,updated_at=NOW() RETURNING id`,
    [barberId, input.dayOfWeek, input.isWorking, input.startTime, input.endTime]);
    await client.query("DELETE FROM barber_schedule_breaks WHERE barber_schedule_id=$1", [result.rows[0].id]);
    for (const item of input.breaks) await client.query("INSERT INTO barber_schedule_breaks (barber_schedule_id,start_time,end_time) VALUES ($1,$2,$3)", [result.rows[0].id, item.startTime, item.endTime]);
    return listBarberSchedules(client, barberId);
  });
}

export async function listBarberUnavailability(db: Db, barberId: number, from?: string, to?: string): Promise<Unavailability[]> {
  const result = await db.query<{ id: number; starts_at: Date; ends_at: Date; reason: string }>(
    `SELECT id, starts_at, ends_at, reason FROM barber_unavailability WHERE barber_id=$1
      AND ($2::timestamptz IS NULL OR ends_at > $2) AND ($3::timestamptz IS NULL OR starts_at < $3) ORDER BY starts_at`,
    [barberId, from ?? null, to ?? null]);
  return result.rows.map((row) => ({ id: row.id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), reason: row.reason }));
}

export async function addBarberUnavailability(db: Db, barberId: number, input: UnavailabilityInput): Promise<Unavailability> {
  unavailabilitySchema.parse(input);
  await requireNoBookingsInPeriod(db, barberId, input.startsAt, input.endsAt);
  const result = await db.query<{ id: number }>(`INSERT INTO barber_unavailability (barber_id,starts_at,ends_at,reason)
    SELECT id,$2,$3,$4 FROM barbers WHERE id=$1 RETURNING id`, [barberId, input.startsAt, input.endsAt, input.reason]);
  if (!result.rows[0]) throw new Error("Barber not found");
  return { id: result.rows[0].id, ...input };
}

export async function removeBarberUnavailability(db: Db, barberId: number, id: number): Promise<boolean> {
  const result = await db.query("DELETE FROM barber_unavailability WHERE barber_id=$1 AND id=$2", [barberId, id]);
  return Boolean(result.rowCount);
}

// Batch the read-only day view; mutations continue to use their locked guards.
export async function listBranchDaySchedules(db: Db, branchId: number, dayOfWeek: number, from: string, to: string) {
  const result = await db.query<{ barberId: number; shift: WeeklySchedule | null; timeAway: Unavailability[] }>(`
    SELECT b.id AS "barberId",
      CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('dayOfWeek',s.day_of_week,'isWorking',s.is_working,
        'startTime',left(s.start_time::text,5),'endTime',left(s.end_time::text,5),
        'breaks',COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',left(br.start_time::text,5),
          'endTime',left(br.end_time::text,5)) ORDER BY br.start_time)
          FROM barber_schedule_breaks br WHERE br.barber_schedule_id=s.id),'[]'::jsonb)) END AS shift,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'startsAt',u.starts_at,'endsAt',u.ends_at,'reason',u.reason)
        ORDER BY u.starts_at) FROM barber_unavailability u WHERE u.barber_id=b.id
        AND u.ends_at>$3::timestamptz AND u.starts_at<$4::timestamptz),'[]'::jsonb) AS "timeAway"
    FROM barbers b LEFT JOIN barber_schedules s ON s.barber_id=b.id AND s.day_of_week=$2
    WHERE b.branch_id=$1 ORDER BY b.id`, [branchId, dayOfWeek, from, to]);
  return result.rows.map((row) => ({ ...row, timeAway: row.timeAway.map((item) => ({ ...item,
    startsAt: new Date(item.startsAt).toISOString(), endsAt: new Date(item.endsAt).toISOString(),
  })) }));
}
