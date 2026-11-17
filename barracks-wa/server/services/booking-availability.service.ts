import type { Pool, PoolClient } from "pg";
import { activeBookingStatusesSql, bookingIntervalStartSql, bookingIntervalEndSql } from "./booking-interval";
import { findServiceById } from "@/server/services/service.service";
import { findBarberById, listBarberAvailability } from "@/server/services/barber.service";
import { listBarberSchedules, listBarberUnavailability, listShopHours, type ShopHours, type WeeklySchedule } from "@/server/services/schedule.service";
import { isWithinBookingWindow, manilaToday } from "@/app/constants/booking";

export type AvailabilitySlot = { startTime: string; endTime: string };
// Why a listed time cannot be booked, so forms can grey it out with a reason.
// "not_enough_time": the start itself is free, but the service would run into the
// next booking, break, time away or the end of the shift.
export type TimeReason = "past" | "booked" | "break" | "away" | "outside_shift" | "not_enough_time";
export type TimeOption = AvailabilitySlot & { available: boolean; reason?: TimeReason };
// Why a whole day has nothing to offer.
export type DayReason = "schedule_not_configured" | "closed" | "not_working" | "barber_unavailable" | "fully_booked" | "past" | "too_far";
export type AvailabilityResult = { date: string; durationMinutes: number; slots: AvailabilitySlot[]; times: TimeOption[]; reason?: DayReason };
export type MonthAvailabilityDay = { date: string; openSlots: number; times: TimeOption[]; reason?: DayReason };
export type BlockedInterval = { start: number; end: number };
type Db = Pool | PoolClient;

export function minuteOfDay(time: string): number { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; }
function clock(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }
export function overlaps(a: BlockedInterval, b: BlockedInterval): boolean { return a.start < b.end && a.end > b.start; }
function intervalFits(input: { start: number; end: number; hours?: ShopHours; schedule?: WeeklySchedule; blocks: BlockedInterval[] }): boolean {
  const { start, end, hours, schedule, blocks } = input;
  if (!hours || hours.isClosed || !schedule?.isWorking) return false;
  if (start < Math.max(minuteOfDay(hours.openTime), minuteOfDay(schedule.startTime)) ||
      end > Math.min(minuteOfDay(hours.closeTime), minuteOfDay(schedule.endTime))) return false;
  const candidate = { start, end };
  return !schedule.breaks.some((item) => overlaps(candidate, { start: minuteOfDay(item.startTime), end: minuteOfDay(item.endTime) })) &&
    !blocks.some((item) => overlaps(candidate, item));
}
export function calculateSlots(input: { date: string; durationMinutes: number; hours?: ShopHours; schedule?: WeeklySchedule; blocks?: BlockedInterval[]; now?: Date }): AvailabilitySlot[] {
  const { date, durationMinutes, hours, schedule, blocks = [], now = new Date() } = input;
  if (!hours || hours.isClosed || !schedule?.isWorking || durationMinutes <= 0) return [];
  const open = Math.max(minuteOfDay(hours.openTime), minuteOfDay(schedule.startTime));
  const close = Math.min(minuteOfDay(hours.closeTime), minuteOfDay(schedule.endTime));
  const nowMs = now.getTime();
  const slots: AvailabilitySlot[] = [];
  for (let start = Math.ceil(open / 15) * 15; start + durationMinutes <= close; start += 15) {
    const end = start + durationMinutes;
    const instant = Date.parse(`${date}T00:00:00+08:00`) + start * 60_000;
    if (instant <= nowMs) continue;
    if (!intervalFits({ start, end, hours, schedule, blocks })) continue;
    slots.push({ startTime: clock(start), endTime: clock(end) });
  }
  return slots;
}

// Every 15-minute start inside shop hours, each marked bookable or not with the first
// rule that blocks it. calculateSlots stays the authority for what is bookable.
export function describeTimes(input: { date: string; durationMinutes: number; hours?: ShopHours; schedule?: WeeklySchedule; booked?: BlockedInterval[]; away?: BlockedInterval[]; now?: Date }): TimeOption[] {
  const { date, durationMinutes, hours, schedule, booked = [], away = [], now = new Date() } = input;
  if (!hours || hours.isClosed || durationMinutes <= 0) return [];
  const bookable = new Set(calculateSlots({ date, durationMinutes, hours, schedule, blocks: [...booked, ...away], now }).map((slot) => slot.startTime));
  const options: TimeOption[] = [];
  const inside = (minute: number, item: BlockedInterval) => minute >= item.start && minute < item.end;
  // List every start up to closing, so a late start that cannot fit is explained instead of hidden.
  for (let start = Math.ceil(minuteOfDay(hours.openTime) / 15) * 15; start < minuteOfDay(hours.closeTime); start += 15) {
    const end = start + durationMinutes;
    const slot = { startTime: clock(start), endTime: clock(end) };
    if (bookable.has(slot.startTime)) { options.push({ ...slot, available: true }); continue; }
    // Name what occupies the chosen start. When the start is free, the service simply does not fit.
    const reason: TimeReason = Date.parse(`${date}T00:00:00+08:00`) + start * 60_000 <= now.getTime() ? "past"
      : !schedule?.isWorking || start < minuteOfDay(schedule.startTime) || start >= minuteOfDay(schedule.endTime) ? "outside_shift"
      : schedule.breaks.some((item) => inside(start, { start: minuteOfDay(item.startTime), end: minuteOfDay(item.endTime) })) ? "break"
      : away.some((item) => inside(start, item)) ? "away"
      : booked.some((item) => inside(start, item)) ? "booked" : "not_enough_time";
    options.push({ ...slot, available: false, reason });
  }
  return options;
}

function dayReason(times: TimeOption[], hours?: ShopHours, schedule?: WeeklySchedule): DayReason | undefined {
  if (times.some((time) => time.available)) return undefined;
  if (!hours || hours.isClosed) return "closed";
  if (!schedule) return "schedule_not_configured";
  if (!schedule.isWorking) return "not_working";
  return times.length && times.every((time) => time.reason === "past") ? "past" : "fully_booked";
}

export class AvailabilityError extends Error {
  constructor(public readonly kind: "service_not_found" | "barber_not_found", message: string) { super(message); }
}

type AvailabilityOptions = { now?: Date; excludeBookingId?: number };
type AvailableBarber = { id: number; status: string; branchId: number };

async function loadContext(db: Db, serviceId: string, date: string) {
  const service = await findServiceById(db, serviceId);
  if (!service?.active || !service.durationMinutes) throw new AvailabilityError("service_not_found", "Service is not available");
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { durationMinutes: service.durationMinutes, weekday, branchHours: new Map<number, Promise<ShopHours[]>>() };
}

function branchHours(db: Db, context: Awaited<ReturnType<typeof loadContext>>, branchId: number) {
  let hours = context.branchHours.get(branchId);
  if (!hours) { hours = listShopHours(db, branchId); context.branchHours.set(branchId, hours); }
  return hours;
}

async function availabilityForBarber(db: Pool, input: { barberId: number; date: string }, barber: AvailableBarber, context: Awaited<ReturnType<typeof loadContext>>, options: AvailabilityOptions): Promise<AvailabilityResult> {
  const empty: AvailabilityResult = { date: input.date, durationMinutes: context.durationMinutes, slots: [], times: [] };
  if (!isWithinBookingWindow(input.date, options.now)) return { ...empty, reason: "too_far" };
  if (barber.status === "unavailable") return { ...empty, reason: "barber_unavailable" };
  const hours = (await branchHours(db, context, barber.branchId)).find((item) => item.dayOfWeek === context.weekday);
  const { schedule, blocks, booked, away } = await loadBarberIntervals(db, input.barberId, input.date, context.weekday, options);
  const times = describeTimes({ date: input.date, durationMinutes: context.durationMinutes, hours, schedule, booked, away, now: options.now });
  const slots = calculateSlots({ date: input.date, durationMinutes: context.durationMinutes, hours: hours, schedule, blocks, now: options.now });
  return { ...empty, slots, times, reason: slots.length ? undefined : dayReason(times, hours, schedule) };
}

async function loadBarberIntervals(db: Db, barberId: number, date: string, weekday: number, options: AvailabilityOptions) {
  const schedules = await listBarberSchedules(db, barberId);
  const absence = await listBarberUnavailability(db, barberId, `${date}T00:00:00+08:00`, new Date(Date.parse(`${date}T00:00:00+08:00`) + 86_400_000).toISOString());
  const bookings = await db.query<{ start_minute: string; end_minute: string }>(
      `SELECT EXTRACT(EPOCH FROM ((${bookingIntervalStartSql}) - $2::date::timestamp))/60 AS start_minute,
         EXTRACT(EPOCH FROM ((${bookingIntervalEndSql}) - $2::date::timestamp))/60 AS end_minute
       FROM bookings WHERE barber_id=$1
       AND status IN ${activeBookingStatusesSql} AND ($3::bigint IS NULL OR id<>$3)
       AND (${bookingIntervalStartSql}) < $2::date::timestamp + INTERVAL '1 day'
       AND (${bookingIntervalEndSql}) > $2::date::timestamp`,
      [barberId, date, options.excludeBookingId ?? null]);
  const schedule = schedules.find((item) => item.dayOfWeek === weekday);
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  const away: BlockedInterval[] = absence.map((item) => ({ start: (Date.parse(item.startsAt) - midnight) / 60_000, end: (Date.parse(item.endsAt) - midnight) / 60_000 }));
  const booked: BlockedInterval[] = bookings.rows.map((row) => ({ start: Number(row.start_minute), end: Number(row.end_minute) }));
  return { schedule, blocks: [...away, ...booked], booked, away };
}

// Queue service starts are immediate, rather than restricted to the booking
// form's 15-minute grid. Use the same boundaries and blocked intervals.
export async function canStartServiceNow(db: Db, input: { serviceId: string; barberId: number }, now = new Date()): Promise<boolean> {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  let context: Awaited<ReturnType<typeof loadContext>>;
  try { context = await loadContext(db, input.serviceId, date); }
  catch (error) { if (error instanceof AvailabilityError && error.kind === "service_not_found") return false; throw error; }
  const barber = await findBarberById(db, input.barberId);
  if (!barber || barber.status === "unavailable") return false;
  const hours = (await branchHours(db, context, barber.branchId)).find((item) => item.dayOfWeek === context.weekday);
  const { schedule, blocks } = await loadBarberIntervals(db, input.barberId, date, context.weekday, {});
  const start = (now.getTime() - Date.parse(`${date}T00:00:00+08:00`)) / 60_000;
  return intervalFits({ start, end: start + context.durationMinutes, hours: hours, schedule, blocks });
}

export async function getBookingAvailability(db: Pool, input: { serviceId: string; barberId: number; date: string; branchId?: number }, options: AvailabilityOptions = {}): Promise<AvailabilityResult> {
  const [context, barber] = await Promise.all([loadContext(db, input.serviceId, input.date), findBarberById(db, input.barberId)]);
  if (!barber || (input.branchId !== undefined && barber.branchId !== input.branchId)) throw new AvailabilityError("barber_not_found", "Barber not found");
  return availabilityForBarber(db, input, barber, context, options);
}

// Why one requested start cannot be booked, for the message shown when a booking is refused.
export async function bookingSlotReason(db: Pool, input: { serviceId: string; barberId: number; date: string; time: string; branchId?: number }, options: { now?: Date; excludeBookingId?: number } = {}): Promise<TimeReason | undefined> {
  const result = await getBookingAvailability(db, input, options);
  return result.times.find((slot) => slot.startTime === input.time && !slot.available)?.reason;
}

export async function isBookingSlotAvailable(db: Pool, input: { serviceId: string; barberId: number; date: string; time: string; branchId?: number }, options: { now?: Date; excludeBookingId?: number } = {}): Promise<boolean> {
  const result = await getBookingAvailability(db, input, options);
  return result.slots.some((slot) => slot.startTime === input.time);
}

export async function findAvailableBarbers(db: Pool, input: { serviceId: string; date: string; time: string; branchId?: number }, options: { now?: Date; excludeBookingId?: number } = {}): Promise<number[]> {
  const [context, allBarbers, counts] = await Promise.all([
    loadContext(db, input.serviceId, input.date),
    listBarberAvailability(db, input.branchId === undefined ? undefined : [input.branchId]),
    db.query<{ barber_id: number; appointment_count: string }>(
      `SELECT barber_id, COUNT(*) AS appointment_count FROM bookings
       WHERE booking_date=$1 AND status IN ${activeBookingStatusesSql}
       AND ($2::bigint IS NULL OR id<>$2) GROUP BY barber_id`,
      [input.date, options.excludeBookingId ?? null],
    ),
  ]);
  const barbers = allBarbers.filter((barber) => barber.status !== "unavailable");
  const eligible = await Promise.all(barbers.map(async (barber) => ({
    id: barber.id,
    available: (await availabilityForBarber(db, { barberId: barber.id, date: input.date }, barber, context, options)).slots.some((slot) => slot.startTime === input.time),
  })));
  const countByBarber = new Map(counts.rows.map((row) => [Number(row.barber_id), Number(row.appointment_count)]));
  return eligible.filter((barber) => barber.available).map((barber) => barber.id)
    .sort((a, b) => (countByBarber.get(a) ?? 0) - (countByBarber.get(b) ?? 0) || a - b);
}

export async function getAnyBarberAvailability(db: Pool, input: { serviceId: string; date: string; branchId?: number }, options: { now?: Date; excludeBookingId?: number } = {}): Promise<AvailabilityResult> {
  const [context, allBarbers] = await Promise.all([loadContext(db, input.serviceId, input.date), listBarberAvailability(db, input.branchId === undefined ? undefined : [input.branchId])]);
  const barbers = allBarbers.filter((barber) => barber.status !== "unavailable");
  const results = await Promise.all(barbers.map((barber) => availabilityForBarber(db, { barberId: barber.id, date: input.date }, barber, context, options)));
  const slots = new Map<string, AvailabilitySlot>();
  results.forEach((result) => result.slots.forEach((slot) => slots.set(slot.startTime, slot)));
  // A time is open when any barber is free; otherwise keep the most specific shared reason.
  const times = new Map<string, TimeOption>();
  results.forEach((result) => result.times.forEach((time) => {
    const current = times.get(time.startTime);
    if (!current || time.available || (!current.available && current.reason !== "past" && time.reason === "past")) times.set(time.startTime, time);
  }));
  const reasons = results.map((result) => result.reason);
  const reason: DayReason | undefined = slots.size ? undefined
    : !isWithinBookingWindow(input.date, options.now) ? "too_far"
    : !barbers.length ? "barber_unavailable"
    : reasons.every((item) => item === reasons[0]) ? reasons[0] : "fully_booked";
  return { date: input.date, durationMinutes: context.durationMinutes, slots: [...slots.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    times: [...times.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)), ...(reason ? { reason } : {}) };
}

// One pass over a calendar month, used to grey out dates before a customer opens them.
// Reads each barber's week, time away and bookings once for the whole month.
export async function getMonthAvailability(db: Pool, input: { serviceId: string; month: string; barberId?: number; branchId?: number }, options: { now?: Date; excludeBookingId?: number } = {}): Promise<MonthAvailabilityDay[]> {
  const now = options.now ?? new Date();
  const first = `${input.month}-01`;
  const context = await loadContext(db, input.serviceId, first);
  const all = input.barberId
    ? [await findBarberById(db, input.barberId)].filter((barber): barber is NonNullable<typeof barber> => Boolean(barber))
    : await listBarberAvailability(db, input.branchId === undefined ? undefined : [input.branchId]);
  if (input.barberId && (!all.length || (input.branchId !== undefined && all[0].branchId !== input.branchId))) throw new AvailabilityError("barber_not_found", "Barber not found");
  const barbers = all.filter((barber) => barber.status !== "unavailable");
  const days: string[] = [];
  for (const cursor = new Date(`${first}T12:00:00Z`); cursor.toISOString().slice(0, 7) === input.month; cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(cursor.toISOString().slice(0, 10));
  const monthStart = `${first}T00:00:00+08:00`;
  const monthEnd = new Date(Date.parse(`${days[days.length - 1]}T00:00:00+08:00`) + 86_400_000).toISOString();
  const perBarber = await Promise.all(barbers.map(async (barber) => {
    const [schedules, absence, bookings, hours] = await Promise.all([
      listBarberSchedules(db, barber.id),
      listBarberUnavailability(db, barber.id, monthStart, monthEnd),
      db.query<{ starts: string; ends: string }>(
        `SELECT EXTRACT(EPOCH FROM ((${bookingIntervalStartSql}) AT TIME ZONE 'Asia/Manila'))*1000 AS starts,
           EXTRACT(EPOCH FROM ((${bookingIntervalEndSql}) AT TIME ZONE 'Asia/Manila'))*1000 AS ends
         FROM bookings WHERE barber_id=$1 AND status IN ${activeBookingStatusesSql} AND ($4::bigint IS NULL OR id<>$4)
         AND (${bookingIntervalStartSql}) < $3::date::timestamp + INTERVAL '1 day' AND (${bookingIntervalEndSql}) > $2::date::timestamp`,
        [barber.id, first, days[days.length - 1], options.excludeBookingId ?? null]),
      branchHours(db, context, barber.branchId),
    ]);
    const away = absence.map((item) => [Date.parse(item.startsAt), Date.parse(item.endsAt)] as const);
    const booked = bookings.rows.map((row) => [Number(row.starts), Number(row.ends)] as const);
    return { schedules, away, booked, hours };
  }));
  return days.map((date) => {
    if (date < manilaToday(now)) return { date, openSlots: 0, times: [], reason: "past" as const };
    if (!isWithinBookingWindow(date, now)) return { date, openSlots: 0, times: [], reason: "too_far" as const };
    if (!barbers.length) return { date, openSlots: 0, times: [], reason: "barber_unavailable" as const };
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    const onDay = (intervals: readonly (readonly [number, number])[]) => intervals.filter(([start, end]) => start < midnight + 86_400_000 && end > midnight)
      .map(([start, end]) => ({ start: (start - midnight) / 60_000, end: (end - midnight) / 60_000 }));
    const merged = new Map<string, TimeOption>();
    const reasons: (DayReason | undefined)[] = [];
    for (const barber of perBarber) {
      const hours = barber.hours.find((item) => item.dayOfWeek === weekday);
      const schedule = barber.schedules.find((item) => item.dayOfWeek === weekday);
      const times = describeTimes({ date, durationMinutes: context.durationMinutes, hours, schedule, booked: onDay(barber.booked), away: onDay(barber.away), now });
      times.forEach((time) => {
        const current = merged.get(time.startTime);
        if (!current || time.available || (!current.available && current.reason !== "past" && time.reason === "past")) merged.set(time.startTime, time);
      });
      reasons.push(dayReason(times, hours, schedule));
    }
    const times = [...merged.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const openSlots = times.filter((time) => time.available).length;
    if (openSlots) return { date, openSlots, times };
    return { date, openSlots, times, reason: reasons.every((item) => item === reasons[0]) ? reasons[0] ?? "fully_booked" : "fully_booked" };
  });
}
