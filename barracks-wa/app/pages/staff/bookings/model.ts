import type { ApiBooking, ApiBookingStatus } from "@/app/lib/api";
import type { BookingFormValue } from "@/app/components/bookings/BookingForm";
import { BOOKING_GRACE_MINUTES } from "@/app/constants/booking";
import { futureDateInputValue } from "@/app/utils/format";

export const statuses: ApiBookingStatus[] = [
  "pending",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
];
// Closed bookings no longer hold a slot; they are hidden unless the status filter asks for them.
// Card headings are short; the drawer shows the full date with the year.
export const cardDate: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};
export const closedStatuses: ApiBookingStatus[] = ["cancelled", "rejected", "no_show"];
export const deletableStatuses: ApiBookingStatus[] = [
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
  "no_show",
];
export const label = (status: string) =>
  status === "pending"
    ? "Awaiting approval"
    : status
        .split("_")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
export const statusMessages: Partial<Record<ApiBookingStatus, string>> = {
  confirmed: "Booking confirmed",
  rejected: "Booking rejected",
  cancelled: "Booking cancelled",
  no_show: "Marked as no show",
  checked_in: "Customer checked in",
  in_progress: "Service started",
  completed: "Service completed",
};
export const freshForm = (customerId = ""): BookingFormValue => ({
  customerId,
  serviceId: "",
  barberId: "",
  date: futureDateInputValue(),
  time: "",
  notes: "",
});
export const formFromBooking = (booking: ApiBooking): BookingFormValue => ({
  customerId: String(booking.customerId),
  serviceId: booking.serviceId,
  barberId: String(booking.barberId),
  date: booking.date,
  time: booking.time,
  notes: booking.notes ?? "",
});
export const bookingPayload = (value: BookingFormValue) => ({
  customerId: Number(value.customerId),
  serviceId: value.serviceId,
  barberId: value.barberId ? Number(value.barberId) : null,
  date: value.date,
  time: value.time,
  notes: value.notes,
});

export const tone = (status: ApiBookingStatus) =>
  status === "completed"
    ? "success"
    : closedStatuses.includes(status)
      ? "danger"
      : status === "checked_in" || status === "pending"
        ? "warning"
        : status === "in_progress"
          ? "purple"
          : "info";

export const noShowFrom = (booking: ApiBooking) => {
  const at = new Date(
    Date.parse(`${booking.date}T${booking.time}:00+08:00`) +
      BOOKING_GRACE_MINUTES * 60_000 +
      8 * 3_600_000,
  );
  return at.toISOString().slice(11, 16);
};
