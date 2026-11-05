import { IconButton } from "@/app/components/ui";
import { lastBookableDate, manilaToday } from "@/app/constants/booking";

export type TimeOption = {
  startTime: string;
  endTime: string;
  available: boolean;
  reason?: string;
};
export type MonthAvailabilityDay = {
  date: string;
  openSlots: number;
  times: TimeOption[];
  reason?: string;
};

const dayReasonLabels: Record<string, string> = {
  closed: "Shop closed",
  not_working: "Barber's day off",
  schedule_not_configured: "Schedule not set yet",
  barber_unavailable: "No barber available",
  fully_booked: "Fully booked",
  past: "Date has passed",
  too_far: "Beyond the 3-month booking window",
};

export function dayReasonLabel(reason: string): string {
  return dayReasonLabels[reason] ?? "Unavailable";
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

// Month grid for booking. Dates without open times are greyed out and explain why.
export function BookingCalendar({
  month,
  days,
  selected,
  loading = false,
  onSelect,
  onMonthChange,
}: {
  month: string;
  days: Record<string, MonthAvailabilityDay>;
  selected: string;
  loading?: boolean;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const firstMonth = manilaToday().slice(0, 7);
  const lastMonth = lastBookableDate().slice(0, 7);
  const first = new Date(`${month}-01T12:00:00Z`);
  const leading = first.getUTCDay();
  const dates: string[] = [];
  for (
    const cursor = new Date(first);
    cursor.toISOString().slice(0, 7) === month;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  )
    dates.push(cursor.toISOString().slice(0, 10));
  const title = first.toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="booking-calendar-picker" aria-busy={loading}>
      <div className="booking-calendar-picker__head">
        <IconButton
          label="Previous month"
          icon="chevronLeft"
          disabled={month <= firstMonth}
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        />
        <strong aria-live="polite">{title}</strong>
        <IconButton
          label="Next month"
          icon="chevronRight"
          disabled={month >= lastMonth}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        />
      </div>
      <div className="booking-calendar-picker__grid" role="group" aria-label={title}>
        {weekdays.map((day) => (
          <span key={day} className="booking-calendar-picker__weekday" aria-hidden="true">
            {day}
          </span>
        ))}
        {Array.from({ length: leading }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {dates.map((date) => {
          const info = days[date];
          const open = Boolean(info?.openSlots);
          const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-PH", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          });
          const status = !info
            ? loading
              ? "Loading"
              : ""
            : open
              ? `${info.openSlots} open time${info.openSlots === 1 ? "" : "s"}`
              : dayReasonLabel(info.reason ?? "fully_booked");
          return (
            <button
              key={date}
              type="button"
              className={`calendar-day ${loading && !info ? "is-loading" : ""}`}
              aria-pressed={selected === date}
              aria-label={`${label}${status ? `, ${status}` : ""}`}
              title={status || undefined}
              disabled={!open}
              onClick={() => onSelect(date)}
            >
              <span>{Number(date.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
