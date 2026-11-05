"use client";

import type { ApiBooking, ApiBarberAvailability } from "@/app/lib/api";
import type { ShopHours, WeeklySchedule, Unavailability } from "@/server/services/schedule.service";
import { formatTime, formatTimeRange } from "@/app/utils/format";

export type DayContext = {
  date: string;
  barbers: { barberId: number; shift: WeeklySchedule | null; timeAway: Unavailability[] }[];
  shopHours: ShopHours | null;
  hoursError: string;
};
const minutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const statusLabel = (value: string) => value.replaceAll("_", " ");
const endMinute = (booking: ApiBooking) =>
  booking.durationMinutes && booking.durationMinutes > 0
    ? minutes(booking.time) + booking.durationMinutes
    : booking.endTime && minutes(booking.endTime) > minutes(booking.time)
      ? minutes(booking.endTime)
      : null;
const manilaNow = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
};
// Pixels per minute: a 30-minute visit is 60px, enough for time, name and service.
const SCALE = 2;
const LEGEND: { status: string; label: string }[] = [
  { status: "pending", label: "Awaiting approval" },
  { status: "confirmed", label: "Confirmed" },
  { status: "checked_in", label: "Checked in" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
  { status: "cancelled", label: "Cancelled / rejected / no show" },
];

export function DaySchedule({
  bookings,
  barbers,
  context,
  date,
  onOpen,
}: {
  bookings: ApiBooking[];
  barbers: ApiBarberAvailability[];
  context: DayContext | null;
  date: string;
  onOpen: (booking: ApiBooking) => void;
}) {
  const times = bookings.flatMap((booking) => [
    minutes(booking.time),
    endMinute(booking) ?? minutes(booking.time),
  ]);
  const unknownDuration = bookings.filter((booking) => endMinute(booking) === null);
  const shopOpen =
    context?.shopHours && !context.shopHours.isClosed
      ? [minutes(context.shopHours.openTime), minutes(context.shopHours.closeTime)]
      : [];
  const shifts =
    context?.barbers.flatMap(({ shift }) =>
      shift?.isWorking ? [minutes(shift.startTime), minutes(shift.endTime)] : [],
    ) ?? [];
  const bounds = [...times, ...shifts, ...shopOpen];
  const start = Math.max(0, Math.floor(Math.min(...(bounds.length ? bounds : [9 * 60])) / 60) * 60);
  const end = Math.min(
    24 * 60,
    Math.ceil(Math.max(...(bounds.length ? bounds : [19 * 60])) / 60) * 60,
  );
  const height = (end - start) * SCALE;
  const hours = Array.from({ length: (end - start) / 60 }, (_, index) => start + index * 60);
  const now = manilaNow();
  const nowOffset =
    now.date === date && now.minute >= start && now.minute <= end
      ? (now.minute - start) * SCALE
      : null;
  const columns = [
    ...barbers.map((barber) => ({ id: barber.id, name: `${barber.firstName} ${barber.lastName}` })),
    ...[
      ...new Set(
        bookings
          .filter((booking) => !barbers.some((barber) => barber.id === booking.barberId))
          .map((booking) => booking.barberId),
      ),
    ].map((id) => ({
      id,
      name: bookings.find((booking) => booking.barberId === id)?.barberName || "Unassigned",
    })),
  ];
  const block = (begin: number, finish: number) => {
    const top = (Math.max(start, begin) - start) * SCALE;
    const size = Math.max(0, Math.min(end, finish) - Math.max(start, begin)) * SCALE;
    return { style: { top, height: size }, roomy: size >= 28 };
  };

  return (
    <>
      <div className="day-schedule__meta">
        <span>
          {context?.shopHours
            ? context.shopHours.isClosed
              ? "Shop closed"
              : `Shop hours ${formatTimeRange(context.shopHours.openTime, context.shopHours.closeTime)}`
            : "Shop hours unavailable"}
        </span>
        <ul className="day-schedule__legend" aria-label="Status colors">
          {LEGEND.map((item) => (
            <li key={item.status} className={`is-${item.status}`}>
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      {context?.hoursError && (
        <p role="alert" className="form-error">
          {context.hoursError}
        </p>
      )}
      {unknownDuration.length > 0 && (
        <div className="duration-unavailable">
          <p>Duration unavailable</p>
          {unknownDuration.map((booking) => (
            <button type="button" key={booking.id} onClick={() => onOpen(booking)}>
              {formatTime(booking.time)} · {booking.customerName} · {booking.serviceName} ·{" "}
              {booking.barberName} · {statusLabel(booking.status)}
            </button>
          ))}
        </div>
      )}
      <div className="day-schedule" aria-label={`Appointments on ${date}`}>
        <div
          className="day-schedule__grid"
          style={{
            gridTemplateColumns: `72px repeat(${Math.max(1, columns.length)}, minmax(180px, 1fr))`,
          }}
        >
          <div className="day-schedule__corner" />
          {columns.map((column) => {
            const data = context?.barbers.find((barber) => barber.barberId === column.id);
            const count = bookings.filter(
              (booking) =>
                booking.barberId === column.id &&
                !["cancelled", "rejected", "no_show"].includes(booking.status),
            ).length;
            return (
              <div className="day-schedule__heading" key={column.id}>
                <strong>{column.name}</strong>
                <small>
                  {!data
                    ? "Schedule unavailable"
                    : !data.shift
                      ? "Shift not set"
                      : data.shift.isWorking
                        ? formatTimeRange(data.shift.startTime, data.shift.endTime)
                        : "Off today"}
                  {count > 0 && ` · ${count} booked`}
                </small>
              </div>
            );
          })}
          <div className="day-schedule__axis" style={{ height }}>
            {hours.map((hour) => (
              <span key={hour} style={{ top: (hour - start) * SCALE }}>
                {formatTime(clock(hour))}
              </span>
            ))}
          </div>
          {columns.map((column) => {
            const data = context?.barbers.find((barber) => barber.barberId === column.id);
            const events = bookings
              .filter((booking) => booking.barberId === column.id && endMinute(booking) !== null)
              .sort((a, b) => a.time.localeCompare(b.time));
            // A component of overlapping intervals shares a lane count, so none occludes another.
            const placed: { booking: ApiBooking; lane: number; lanes: number }[] = [];
            let group: typeof placed = [];
            let groupEnd = -1;
            let laneEnds: number[] = [];
            const flush = () => {
              group.forEach((entry) => {
                entry.lanes = laneEnds.length;
              });
              placed.push(...group);
              group = [];
              laneEnds = [];
            };
            events.forEach((booking) => {
              const begin = minutes(booking.time);
              const finish = endMinute(booking)!;
              if (begin >= groupEnd) flush();
              let lane = laneEnds.findIndex((value) => value <= begin);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = finish;
              groupEnd = Math.max(...laneEnds);
              group.push({ booking, lane, lanes: 1 });
            });
            flush();
            const constraints: {
              key: string;
              label: string;
              begin: number;
              finish: number;
              away?: boolean;
            }[] = [];
            if (data?.shift && !data.shift.isWorking)
              constraints.push({ key: "off", label: "Off today", begin: start, finish: end });
            if (data?.shift?.isWorking) {
              constraints.push({
                key: "before",
                label: "Off shift",
                begin: start,
                finish: minutes(data.shift.startTime),
              });
              constraints.push({
                key: "after",
                label: "Off shift",
                begin: minutes(data.shift.endTime),
                finish: end,
              });
              data.shift.breaks.forEach((pause, index) =>
                constraints.push({
                  key: `break-${index}`,
                  label: `Break ${formatTimeRange(pause.startTime, pause.endTime)}`,
                  begin: minutes(pause.startTime),
                  finish: minutes(pause.endTime),
                }),
              );
            }
            const dayStart = Date.parse(`${date}T00:00:00+08:00`);
            data?.timeAway.forEach((away) =>
              constraints.push({
                key: `away-${away.id}`,
                label: `Away · ${away.reason}`,
                begin: (Date.parse(away.startsAt) - dayStart) / 60000,
                finish: (Date.parse(away.endsAt) - dayStart) / 60000,
                away: true,
              }),
            );
            return (
              <div className="day-schedule__column" key={column.id} style={{ height }}>
                {hours.map((hour) => (
                  <div
                    className="day-schedule__hour"
                    key={hour}
                    style={{ top: (hour - start) * SCALE }}
                  />
                ))}
                {hours.map((hour) => (
                  <div
                    className="day-schedule__half"
                    key={`h${hour}`}
                    style={{ top: (hour - start + 30) * SCALE }}
                  />
                ))}
                {constraints.map((item) => {
                  const { style, roomy } = block(item.begin, item.finish);
                  return (
                    style.height > 0 && (
                      <div
                        className={`day-schedule__constraint${item.away ? " day-schedule__constraint--away" : ""}`}
                        key={item.key}
                        style={style}
                      >
                        {roomy && <span>{item.label}</span>}
                      </div>
                    )
                  );
                })}
                {placed.map(({ booking, lane, lanes }) => {
                  const finish = endMinute(booking)!;
                  const { style } = block(minutes(booking.time), finish);
                  return (
                    <button
                      type="button"
                      className={`day-schedule__booking is-${booking.status}`}
                      key={booking.id}
                      style={{
                        ...style,
                        left: `calc(${(lane / lanes) * 100}% + 3px)`,
                        width: `calc(${100 / lanes}% - 6px)`,
                      }}
                      onClick={() => onOpen(booking)}
                      aria-label={`${booking.customerName}, ${booking.serviceName}, ${booking.time}, ${statusLabel(booking.status)}, ${column.name}`}
                    >
                      <span>{formatTimeRange(booking.time, clock(finish))}</span>
                      <strong>{booking.customerName}</strong>
                      <small>{booking.serviceName}</small>
                    </button>
                  );
                })}
                {nowOffset !== null && (
                  <div
                    className="day-schedule__now"
                    style={{ top: nowOffset }}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
