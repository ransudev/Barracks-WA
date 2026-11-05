import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiBarberAvailability, ApiCustomer } from "@/app/lib/api";
import type { Service } from "@/app/types/domain";
import { Button, SelectField, TextField } from "@/app/components/ui";
import { formatDate, formatTime, formatTimeRange } from "@/app/utils/format";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import { hasAppointmentCustomer, isAppointmentCustomer } from "@/app/utils/booking-customers";
import {
  BookingCalendar,
  dayReasonLabel,
  type MonthAvailabilityDay,
} from "@/app/components/bookings/BookingCalendar";
import { BOOKING_WINDOW_DAYS, lastBookableDate, manilaToday } from "@/app/constants/booking";

export type BookingFormValue = {
  customerId: string;
  serviceId: string;
  barberId: string;
  date: string;
  time: string;
  notes: string;
};

const timeReasonLabel: Record<string, string> = {
  past: "Already passed",
  booked: "Booked",
  break: "Barber on break",
  away: "Barber away",
  outside_shift: "Outside barber's shift",
};

// Availability changes as other people book; refresh quietly while the form is open.
const LIVE_REFRESH_MS = 30_000;

export function BookingForm({
  value,
  branchId,
  customers = [],
  services,
  barbers,
  hideCustomer = false,
  requireBarber = false,
  excludeBookingId,
  availabilityVersion = 0,
  submitLabel = "Save booking",
  submitting = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: BookingFormValue;
  branchId?: number;
  customers?: ApiCustomer[];
  services: Service[];
  barbers: ApiBarberAvailability[];
  hideCustomer?: boolean;
  requireBarber?: boolean;
  excludeBookingId?: number;
  availabilityVersion?: number;
  submitLabel?: string;
  submitting?: boolean;
  onChange: (value: BookingFormValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const { serviceId, barberId, date } = value;
  const [month, setMonth] = useState(() => (date || manilaToday()).slice(0, 7));
  const [days, setDays] = useState<Record<string, MonthAvailabilityDay>>({});
  const [loading, setLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const cache = useRef(new Map<string, MonthAvailabilityDay[]>());
  const eligibleCustomers = customers.filter(isAppointmentCustomer);
  const customerEligible =
    hideCustomer || hasAppointmentCustomer(eligibleCustomers, value.customerId);
  const readyForAvailability = Boolean(serviceId && (!requireBarber || barberId));

  useEffect(() => {
    if (!hideCustomer && value.customerId && !customerEligible) {
      onChange({ ...value, customerId: "" });
    }
  }, [hideCustomer, customerEligible, value, onChange]);

  const fetchMonth = useCallback(
    async (target: string) => {
      const params = new URLSearchParams({ serviceId, month: target });
      if (branchId) params.set("branchId", String(branchId));
      if (barberId) params.set("barberId", barberId);
      if (excludeBookingId) params.set("excludeBookingId", String(excludeBookingId));
      const response = await apiRequest(`/api/bookings/availability/month?${params}`, {
        cache: "no-store",
      });
      const body = await readApiBody<{
        success: boolean;
        days?: MonthAvailabilityDay[];
        message?: string;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to load available times");
      const result = body.days ?? [];
      cache.current.set(`${serviceId}|${barberId}|${excludeBookingId ?? ""}|${target}`, result);
      return result;
    },
    [branchId, serviceId, barberId, excludeBookingId],
  );

  // Show cached data at once, then refresh. Prefetch the next month so paging is instant.
  useEffect(() => {
    if (!readyForAvailability) return;
    let active = true;
    const key = `${serviceId}|${barberId}|${excludeBookingId ?? ""}|${month}`;
    const cached = cache.current.get(key);
    const apply = (list: MonthAvailabilityDay[]) =>
      setDays(Object.fromEntries(list.map((day) => [day.date, day])));
    if (cached) apply(cached);
    else setDays({});
    async function load(quiet: boolean) {
      if (!quiet) setLoading(!cached);
      try {
        const list = await fetchMonth(month);
        if (!active) return;
        apply(list);
        setAvailabilityError("");
      } catch (error) {
        if (active && !quiet)
          setAvailabilityError(errorMessage(error, "Unable to load available times"));
      } finally {
        if (active && !quiet) setLoading(false);
      }
    }
    void load(false);
    const next = new Date(`${month}-15T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonth = next.toISOString().slice(0, 7);
    if (
      nextMonth <= lastBookableDate().slice(0, 7) &&
      !cache.current.has(`${serviceId}|${barberId}|${excludeBookingId ?? ""}|${nextMonth}`)
    ) {
      void fetchMonth(nextMonth).catch(() => undefined);
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, LIVE_REFRESH_MS);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [
    readyForAvailability,
    fetchMonth,
    month,
    serviceId,
    barberId,
    excludeBookingId,
    availabilityVersion,
  ]);

  const day = date ? days[date] : undefined;
  const times = readyForAvailability && day ? day.times : [];
  const selectedSlot = times.find((slot) => slot.startTime === value.time && slot.available);

  // A live refresh can show that the chosen time was just taken.
  const timeTaken = Boolean(value.time && day && !selectedSlot);

  const selectedService = services.find((service) => service.id === value.serviceId);
  const selectedBarber = barbers.find((barber) => String(barber.id) === value.barberId);
  return (
    <form
      className="modal-form booking-form"
      onSubmit={(event) => {
        if (!customerEligible) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      {!hideCustomer && (
        <SelectField
          label="Customer"
          required
          value={value.customerId}
          onChange={(event) => onChange({ ...value, customerId: event.target.value })}
        >
          <option value="">Choose a customer</option>
          {eligibleCustomers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.firstName} {customer.lastName}
            </option>
          ))}
        </SelectField>
      )}
      {!hideCustomer && (
        <p className="form-hint">
          Appointments require a registered customer account. Add accountless walk-ins through
          Queue.
        </p>
      )}
      <div className="form-grid form-grid--two">
        <SelectField
          label="Service"
          required
          value={value.serviceId}
          onChange={(event) => onChange({ ...value, serviceId: event.target.value, time: "" })}
        >
          <option value="">Choose a service</option>
          {services
            .filter((service) => service.active)
            .map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMinutes} mins · ₱{service.price}
              </option>
            ))}
        </SelectField>
        <SelectField
          label="Barber"
          required={requireBarber}
          value={value.barberId}
          onChange={(event) => onChange({ ...value, barberId: event.target.value, time: "" })}
        >
          <option value="">{requireBarber ? "Choose a barber" : "Any available barber"}</option>
          {barbers
            .filter((barber) => barber.status !== "unavailable")
            .map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.firstName} {barber.lastName}
              </option>
            ))}
        </SelectField>
      </div>

      <fieldset className="booking-picker" disabled={!readyForAvailability}>
        <legend>Date and time</legend>
        {!readyForAvailability ? (
          <p className="form-hint">
            {requireBarber
              ? "Choose a service and barber to see open dates."
              : "Choose a service to see open dates."}
          </p>
        ) : (
          <>
            <BookingCalendar
              month={month}
              onMonthChange={setMonth}
              days={days}
              selected={date}
              loading={loading}
              onSelect={(next) => onChange({ ...value, date: next, time: "" })}
            />
            <p className="form-hint">
              Bookings open up to {BOOKING_WINDOW_DAYS} days ahead (until{" "}
              {formatDate(lastBookableDate())}). Greyed-out dates have no open times.
            </p>
            {availabilityError && (
              <p role="alert" className="form-error">
                {availabilityError}
              </p>
            )}
            {date && day && (
              <div
                className="booking-times"
                role="group"
                aria-label={`Times on ${formatDate(date)}`}
              >
                <div className="booking-times__head">
                  <strong>
                    {formatDate(date, { weekday: "long", month: "long", day: "numeric" })}
                  </strong>
                  {day.reason && (
                    <span className="booking-times__reason">{dayReasonLabel(day.reason)}</span>
                  )}
                </div>
                {times.length ? (
                  <div className="booking-times__grid">
                    {times.map((slot) => (
                      <button
                        key={slot.startTime}
                        type="button"
                        className="time-chip"
                        aria-pressed={value.time === slot.startTime}
                        disabled={!slot.available}
                        title={
                          slot.available ? undefined : timeReasonLabel[slot.reason ?? "booked"]
                        }
                        onClick={() => onChange({ ...value, time: slot.startTime })}
                      >
                        <span>{formatTime(slot.startTime)}</span>
                        {!slot.available && (
                          <small>{timeReasonLabel[slot.reason ?? "booked"]}</small>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="form-hint">
                    {day.reason
                      ? `${dayReasonLabel(day.reason)}. Try another date${requireBarber ? " or barber" : ""}.`
                      : "No times on this date."}
                  </p>
                )}
              </div>
            )}
            {timeTaken && (
              <p role="status" className="form-error">
                The time you picked was just taken. Please choose another.
              </p>
            )}
          </>
        )}
      </fieldset>

      <TextField
        label="Notes (optional)"
        value={value.notes}
        maxLength={500}
        onChange={(event) => onChange({ ...value, notes: event.target.value })}
      />
      {selectedSlot && selectedService && (
        <div className="booking-form-review" aria-label="Review booking">
          <h3>Review appointment</h3>
          <p>
            {selectedService.name} · {selectedService.durationMinutes} minutes · ₱
            {selectedService.price}
          </p>
          <p>
            {selectedBarber
              ? `${selectedBarber.firstName} ${selectedBarber.lastName}`
              : "Any available barber"}{" "}
            · {formatDate(value.date)} ·{" "}
            {formatTimeRange(selectedSlot.startTime, selectedSlot.endTime)}
          </p>
          <p>Notes: {value.notes.trim() || "None"}</p>
        </div>
      )}
      <div className="modal-actions">
        <Button variant="secondary" type="button" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          icon="calendar"
          disabled={!customerEligible || submitting || !selectedSlot}
        >
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
