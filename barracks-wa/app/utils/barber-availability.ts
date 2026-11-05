import type { ApiBarberAvailability, ApiOperationalAvailability } from "@/app/lib/api";

export const isBarberAvailable = (barber: ApiBarberAvailability) =>
  barber.operationalAvailability?.available ?? barber.status === "available";

const reasons: Record<NonNullable<ApiOperationalAvailability["reason"]>, string> = {
  absent: "Absent today",
  clocked_out: "Clocked out",
  barber_not_found: "Barber not found",
  invalid_branch: "Different branch",
  duration_unknown: "Duration needs review",
  reservation_collision: "Appointment conflict",
  unavailable: "Unavailable",
  serving_customer: "In service",
  off_shift: "Off shift",
  break: "Scheduled break",
  temporary_unavailability: "Time away",
};

export function barberAvailabilityLabel(barber: ApiBarberAvailability): string {
  const availability = barber.operationalAvailability;
  if (availability)
    return availability.available
      ? "Available"
      : availability.reason
        ? reasons[availability.reason]
        : "Unavailable";
  return barber.status === "available"
    ? "Available"
    : barber.status === "busy"
      ? "Busy"
      : "Unavailable";
}
