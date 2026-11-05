export type ReportRange = { from: string; to: string };
export type ReportPreset = "Today" | "This week" | "This month" | "Last 30 days";

export function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftDate(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function presetRange(preset: ReportPreset): ReportRange {
  const to = manilaToday();
  if (preset === "Today") return { from: to, to };
  if (preset === "This month") return { from: `${to.slice(0, 7)}-01`, to };
  if (preset === "This week") {
    const weekday = new Date(`${to}T00:00:00Z`).getUTCDay();
    return { from: shiftDate(to, -((weekday + 6) % 7)), to };
  }
  return { from: shiftDate(to, -29), to };
}

export function displayDate(
  day: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
