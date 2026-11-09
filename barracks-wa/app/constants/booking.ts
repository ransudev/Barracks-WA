export const BOOKING_GRACE_MINUTES = 10;
// Appointments can be requested up to three months ahead (Asia/Manila calendar days).
export const BOOKING_WINDOW_DAYS = 90;
// Each pending request reserves its slot, so a customer may only have this many
// future requests awaiting staff approval at once.
export const MAX_PENDING_BOOKING_REQUESTS = 3;

export function mayMarkNoShow(date: string, time: string, now = new Date()): boolean {
  return now.getTime() >= Date.parse(`${date}T${time}:00+08:00`) + BOOKING_GRACE_MINUTES * 60_000;
}

export function manilaToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function lastBookableDate(now = new Date()): string {
  const limit = new Date(`${manilaToday(now)}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + BOOKING_WINDOW_DAYS);
  return limit.toISOString().slice(0, 10);
}

export function isWithinBookingWindow(date: string, now = new Date()): boolean {
  return date <= lastBookableDate(now);
}
