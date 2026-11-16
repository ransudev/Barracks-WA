export const BOOKING_GRACE_MINUTES = 10;
// Appointments can be requested up to three months ahead (Asia/Manila calendar days).
export const BOOKING_WINDOW_DAYS = 90;
// Each pending request reserves its slot, so a customer may only have this many
// future requests awaiting staff approval at once.
export const MAX_PENDING_BOOKING_REQUESTS = 3;

// A booking's start instant has passed (Asia/Manila wall time).
export function bookingHasStarted(date: string, time: string, now = new Date()): boolean {
  return now.getTime() >= Date.parse(`${date}T${time}:00+08:00`);
}

// Check-in is only for appointments dated today in Manila.
export function isBookingDay(date: string, now = new Date()): boolean {
  return date === manilaToday(now);
}

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

// A booking is held with a partial payment: half the service price, in whole pesos.
export const BOOKING_DEPOSIT_RATE = 0.5;
export function bookingDeposit(price: number): number {
  return price > 0 ? Math.min(price, Math.ceil(price * BOOKING_DEPOSIT_RATE)) : 0;
}

// Minutes an unattended appointment is past its start, or 0 while it is not yet late.
export function minutesLate(date: string, time: string, now = new Date()): number {
  const late = Math.floor((now.getTime() - Date.parse(`${date}T${time}:00+08:00`)) / 60_000);
  return late > BOOKING_GRACE_MINUTES ? late : 0;
}
