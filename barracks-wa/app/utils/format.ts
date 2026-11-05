export function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function dateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function futureDateInputValue() {
  return dateInputValue(new Date(Date.now() + 86_400_000));
}

export function createInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function createSlug(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

// "14:30" -> "2:30 PM". Shop times are stored as 24-hour Asia/Manila wall-clock values.
export function formatTime(time: string | null | undefined) {
  if (!time) return "—";
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined) {
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

// "2026-10-21" -> "Wed, Oct 21, 2026"
export function formatDate(
  date: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) {
  if (!date) return "—";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-PH", { ...options, timeZone: "UTC" });
}
