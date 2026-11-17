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
import {
  BOOKING_DEPOSIT_RATE,
  BOOKING_WINDOW_DAYS,
  bookingDeposit,
  lastBookableDate,
  manilaToday,
} from "@/app/constants/booking";
import { Icon } from "@/app/components/ui/icons";

export type BookingFormValue = {
  customerId: string;
  serviceId: string;
  barberId: string;
  date: string;
  time: string;
  notes: string;
  // How the booking deposit was paid (new bookings only).
  depositMethod?: string;
  depositReference?: string;
};

// Customers pay the deposit ahead; staff may also take it at the counter.
const depositMethods = {
  customer: [
    { id: "e_wallet", label: "E-wallet" },
    { id: "bank_transfer", label: "Bank transfer" },
  ],
  staff: [
    { id: "cash", label: "Cash" },
    { id: "e_wallet", label: "E-wallet" },
    { id: "card", label: "Card" },
    { id: "bank_transfer", label: "Bank transfer" },
  ],
};

const timeReasonLabel: Record<string, string> = {
  past: "Already passed",
  booked: "Booked",
  break: "Barber on break",
  away: "Barber away",
  outside_shift: "Outside barber's shift",
  not_enough_time: "Not enough time",
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
  showPackages = false,
  depositMode,
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
  // Show each service as a card listing what the package includes.
  showPackages?: boolean;
  // Collect the booking deposit: customers give a payment reference, staff record how it was taken.
  depositMode?: "customer" | "staff";
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
  const deposit = depositMode && selectedService ? bookingDeposit(selectedService.price) : 0;
  const depositReady =
    !deposit ||
    (Boolean(value.depositMethod) &&
      (depositMode === "staff" || Boolean(value.depositReference?.trim())));
  const activeServices = services.filter((service) => service.active);
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
      {showPackages && (
        <fieldset className="package-picker">
          <legend>Choose a package</legend>
          <div className="package-picker__grid">
            {activeServices.map((service) => (
              <button
                key={service.id}
                type="button"
                className="package-card"
                aria-pressed={value.serviceId === service.id}
                onClick={() => onChange({ ...value, serviceId: service.id, time: "" })}
              >
                <span className="package-card__head">
                  <strong>{service.name}</strong>
                  <span className="package-card__price">₱{service.price.toLocaleString()}</span>
                </span>
                <span className="package-card__meta">
                  <Icon name="clock" size={13} /> {service.durationMinutes} mins
                </span>
                {service.description && (
                  <span className="package-card__description">{service.description}</span>
                )}
                {(service.inclusions?.length ?? 0) > 0 && (
                  <span className="package-card__includes">
                    <span className="package-card__label">Includes</span>
                    {service.inclusions!.map((item) => (
                      <span key={item} className="package-card__item">
                        <Icon name="check" size={13} /> {item}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className={showPackages ? "form-grid" : "form-grid form-grid--two"}>
        {!showPackages && (
          <SelectField
            label="Service"
            required
            value={value.serviceId}
            onChange={(event) => onChange({ ...value, serviceId: event.target.value, time: "" })}
          >
            <option value="">Choose a service</option>
            {activeServices.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMinutes} mins · ₱{service.price}
              </option>
            ))}
          </SelectField>
        )}
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
      {!showPackages && selectedService && (selectedService.inclusions?.length ?? 0) > 0 && (
        <p className="form-hint package-inline">
          <strong>{selectedService.name} includes:</strong>{" "}
          {selectedService.inclusions!.join(" · ")}
        </p>
      )}

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
      {deposit > 0 && selectedService && (
        <fieldset className="deposit-box">
          <legend>Deposit required</legend>
          <p className="deposit-box__amount">
            <strong>₱{deposit.toLocaleString()}</strong>
            <span>
              {Math.round(BOOKING_DEPOSIT_RATE * 100)}% of ₱{selectedService.price.toLocaleString()}{" "}
              holds this appointment. The remaining ₱
              {(selectedService.price - deposit).toLocaleString()} is paid at the shop.
            </span>
          </p>
          <div className="form-grid form-grid--two">
            <SelectField
              label={depositMode === "customer" ? "Paid through" : "Deposit received by"}
              required
              value={value.depositMethod ?? ""}
              onChange={(event) => onChange({ ...value, depositMethod: event.target.value })}
            >
              <option value="">Choose a method</option>
              {depositMethods[depositMode!].map((method) => (
                <option key={method.id} value={method.id}>
                  {method.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label={
                depositMode === "customer" ? "Payment reference no." : "Reference no. (optional)"
              }
              required={depositMode === "customer"}
              maxLength={80}
              value={value.depositReference ?? ""}
              onChange={(event) => onChange({ ...value, depositReference: event.target.value })}
            />
          </div>
          {depositMode === "customer" && (
            <p className="form-hint">
              Send the deposit to the shop, then enter the reference number of your payment. Staff
              verify it before confirming your appointment.
            </p>
          )}
        </fieldset>
      )}
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
          {deposit > 0 && (
            <p>
              Deposit ₱{deposit.toLocaleString()} · Balance at the shop ₱
              {(selectedService.price - deposit).toLocaleString()}
            </p>
          )}
        </div>
      )}
      <div className="modal-actions">
        <Button variant="secondary" type="button" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          icon="calendar"
          disabled={!customerEligible || submitting || !selectedSlot || !depositReady}
        >
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
