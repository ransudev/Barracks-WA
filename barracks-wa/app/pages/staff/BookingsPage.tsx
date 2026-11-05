"use client";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BookingForm, type BookingFormValue } from "@/app/components/bookings/BookingForm";
import type { Service } from "@/app/types/domain";
import type {
  ApiBarberAvailability,
  ApiBooking,
  ApiBookingStatus,
  ApiCustomer,
} from "@/app/lib/api";
import { apiRequest, peekApiBody, readApiBody } from "@/app/lib/api";
import { ScheduleSkeleton } from "@/app/components/ui/Skeletons";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import {
  createInitials,
  dateInputValue,
  formatCurrency,
  formatDate,
  formatTime,
  formatTimeRange,
  futureDateInputValue,
} from "@/app/utils/format";
import {
  DetailDrawer,
  DrawerSection,
  FreshnessBar,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";
import { DaySchedule, type DayContext } from "@/app/components/bookings/DaySchedule";
import { BOOKING_GRACE_MINUTES, mayMarkNoShow } from "@/app/constants/booking";
import { hasAppointmentCustomer, isAppointmentCustomer } from "@/app/utils/booking-customers";

const statuses: ApiBookingStatus[] = [
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
const cardDate: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const closedStatuses: ApiBookingStatus[] = ["cancelled", "rejected", "no_show"];
const deletableStatuses: ApiBookingStatus[] = [
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
  "no_show",
];
const label = (status: string) =>
  status === "pending"
    ? "Awaiting approval"
    : status
        .split("_")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
const statusMessages: Partial<Record<ApiBookingStatus, string>> = {
  confirmed: "Booking confirmed",
  rejected: "Booking rejected",
  cancelled: "Booking cancelled",
  no_show: "Marked as no show",
  checked_in: "Customer checked in",
  in_progress: "Service started",
  completed: "Service completed",
};
const freshForm = (customerId = ""): BookingFormValue => ({
  customerId,
  serviceId: "",
  barberId: "",
  date: futureDateInputValue(),
  time: "",
  notes: "",
});
const formFromBooking = (booking: ApiBooking): BookingFormValue => ({
  customerId: String(booking.customerId),
  serviceId: booking.serviceId,
  barberId: String(booking.barberId),
  date: booking.date,
  time: booking.time,
  notes: booking.notes ?? "",
});
const bookingPayload = (value: BookingFormValue) => ({
  customerId: Number(value.customerId),
  serviceId: value.serviceId,
  barberId: value.barberId ? Number(value.barberId) : null,
  date: value.date,
  time: value.time,
  notes: value.notes,
});

export function BookingsPage({ onToast }: { onToast: (message: string) => void }) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = useBranchContext();
  const branchControl = (
    <BranchSwitcher
      branches={branches}
      value={branchId}
      loading={branchLoading}
      onChange={setBranchId}
    />
  );
  if (branchId > 0)
    return (
      <BookingsPageContent
        key={branchId}
        branchId={branchId}
        branchControl={branchControl}
        onToast={onToast}
      />
    );
  return (
    <div className="operational-workspace">
      <PageHeader title="Bookings" action={branchControl} />
      {branchError ? (
        <p role="alert">{branchError}</p>
      ) : branchLoading ? (
        <Panel>
          <ScheduleSkeleton gridOnly label="Loading bookings" />
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon="calendar"
            title="No branch assigned"
            description="Ask an administrator to assign you to a branch."
          />
        </Panel>
      )}
    </div>
  );
}

function BookingsPageContent({
  onToast,
  branchId,
  branchControl,
}: {
  onToast: (message: string) => void;
  branchId: number;
  branchControl: ReactNode;
}) {
  // Paint the last known data at once (if any), then refresh in the background.
  const [cached] = useState(() => ({
    bookings: peekApiBody<{ bookings?: ApiBooking[] }>(`/api/bookings?branchId=${branchId}`)
      ?.bookings,
    customers: peekApiBody<{ customers?: ApiCustomer[] }>("/api/customers")?.customers,
    barbers: peekApiBody<{ barbers?: ApiBarberAvailability[] }>(`/api/barbers?branchId=${branchId}`)
      ?.barbers,
    services: peekApiBody<{ services?: Service[] }>("/api/services")?.services,
  }));
  const hasCache = Boolean(
    cached.bookings && cached.customers && cached.barbers && cached.services,
  );
  const [items, setItems] = useState<ApiBooking[]>(cached.bookings ?? []);
  const [customers, setCustomers] = useState<ApiCustomer[]>(
    (cached.customers ?? []).filter(isAppointmentCustomer),
  );
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>(cached.barbers ?? []);
  const [services, setServices] = useState<Service[]>(cached.services ?? []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("open");
  const [date, setDate] = useState(dateInputValue);
  const [barberFilter, setBarberFilter] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => (hasCache ? Date.now() : null));
  const [dayView, setDayView] = useState(true);
  const [context, setContext] = useState<DayContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [view] = useState<OperationalViewMode>("cards");
  const [selected, setSelected] = useState<ApiBooking | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<BookingFormValue>(freshForm());
  const [busy, setBusy] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [pendingCancellation, setPendingCancellation] = useState<ApiBooking | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<ApiBooking | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [branchId]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [bookingResponse, customerResponse, barberResponse, serviceResponse] =
          await Promise.all([
            apiRequest(`/api/bookings?branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/customers", { cache: "no-store" }),
            apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/services", { cache: "no-store" }),
          ]);
        const [bookings, customerData, barberData, serviceData] = await Promise.all([
          readApiBody<{ success: boolean; bookings?: ApiBooking[]; message?: string }>(
            bookingResponse,
          ),
          readApiBody<{ success: boolean; customers?: ApiCustomer[]; message?: string }>(
            customerResponse,
          ),
          readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[]; message?: string }>(
            barberResponse,
          ),
          readApiBody<{ success: boolean; services?: Service[]; message?: string }>(
            serviceResponse,
          ),
        ]);
        if (
          !bookingResponse.ok ||
          !bookings?.success ||
          !customerResponse.ok ||
          !customerData?.success ||
          !barberResponse.ok ||
          !barberData?.success ||
          !serviceResponse.ok ||
          !serviceData?.success
        ) {
          throw new Error(
            bookings?.message ??
              customerData?.message ??
              barberData?.message ??
              serviceData?.message ??
              "Unable to load bookings",
          );
        }
        if (!active) return;
        setItems(bookings.bookings ?? []);
        setCustomers((customerData.customers ?? []).filter(isAppointmentCustomer));
        setBarbers(barberData.barbers ?? []);
        setServices(serviceData.services ?? []);
        setLoadError("");
        setUpdatedAt(Date.now());
      } catch (error) {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Unable to load bookings");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [branchId, refreshVersion]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiRequest(`/api/scheduling/day?date=${date}&branchId=${branchId}`, {
          cache: "no-store",
        });
        const body = await readApiBody<DayContext & { success: boolean; message?: string }>(
          response,
        );
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Schedule constraints unavailable");
        if (active) {
          setContext(body);
          setContextError("");
        }
      } catch (cause) {
        if (active) {
          setContext(null);
          setContextError(
            cause instanceof Error ? cause.message : "Schedule constraints unavailable",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [branchId, date, refreshVersion]);

  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (!date || item.date === date) &&
            (!barberFilter || String(item.barberId) === barberFilter) &&
            (tab === "all" ||
              (tab === "open" ? !closedStatuses.includes(item.status) : item.status === tab)) &&
            `${item.id} ${item.customerName} ${item.barberName} ${item.serviceName}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [items, tab, search, date, barberFilter],
  );
  // Requests waiting for staff approval, across all dates, soonest first.
  const awaiting = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.status === "pending" && (!barberFilter || String(item.barberId) === barberFilter),
        )
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [items, barberFilter],
  );
  const openDetails = (booking: ApiBooking) => {
    setSelected(booking);
    setEditing(false);
  };
  const moveDate = (offset: number) => {
    const next = new Date(`${date || dateInputValue()}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + offset);
    setDate(next.toISOString().slice(0, 10));
  };
  const bookingForm = (
    <BookingForm
      branchId={branchId}
      value={draft}
      customers={customers}
      services={services}
      barbers={barbers}
      excludeBookingId={editing ? selected?.id : undefined}
      availabilityVersion={availabilityVersion}
      submitLabel={editing ? "Save booking" : "Create booking"}
      submitting={busy}
      onChange={setDraft}
      onSubmit={saveBooking}
      onCancel={() => {
        setCreating(false);
        setEditing(false);
      }}
    />
  );

  async function saveBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasAppointmentCustomer(customers, draft.customerId) || !draft.serviceId || !draft.time)
      return;
    setBusy(true);
    try {
      const response = await apiRequest(
        editing && selected ? `/api/bookings/${selected.id}` : `/api/bookings?branchId=${branchId}`,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(bookingPayload(draft)),
        },
      );
      const body = await readApiBody<{ success: boolean; booking?: ApiBooking; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.booking)
        throw new Error(body?.message ?? "Unable to save booking");
      setItems((current) =>
        editing
          ? current.map((item) => (item.id === body.booking!.id ? body.booking! : item))
          : [...current, body.booking!],
      );
      setSelected(editing ? body.booking : null);
      setEditing(false);
      setCreating(false);
      onToast("Booking saved");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to save booking");
      setDraft((current) => ({ ...current, time: "" }));
      setAvailabilityVersion((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(booking: ApiBooking, status: ApiBookingStatus) {
    setBusy(true);
    try {
      const response = await apiRequest(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const body = await readApiBody<{ success: boolean; booking?: ApiBooking; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.booking)
        throw new Error(body?.message ?? "Unable to update booking");
      setItems((current) => current.map((item) => (item.id === booking.id ? body.booking! : item)));
      setSelected((current) => (current?.id === booking.id ? body.booking! : current));
      setPendingCancellation(null);
      onToast(statusMessages[status] ?? `Booking marked ${label(status)}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to update booking");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBooking(booking: ApiBooking) {
    setBusy(true);
    try {
      const response = await apiRequest(`/api/bookings/${booking.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to delete booking");
      setItems((current) => current.filter((item) => item.id !== booking.id));
      setSelected(null);
      setPendingDeletion(null);
      onToast("Booking deleted");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to delete booking");
    } finally {
      setBusy(false);
    }
  }

  const openEdit = (booking: ApiBooking) => {
    if (!["pending", "confirmed"].includes(booking.status)) return;
    setSelected(booking);
    setDraft(formFromBooking(booking));
    setEditing(true);
  };
  const noShowFrom = (booking: ApiBooking) => {
    const at = new Date(
      Date.parse(`${booking.date}T${booking.time}:00+08:00`) +
        BOOKING_GRACE_MINUTES * 60_000 +
        8 * 3_600_000,
    );
    return at.toISOString().slice(11, 16);
  };
  const quickActions = (booking: ApiBooking) =>
    booking.status === "pending" ? (
      <>
        <Button
          size="sm"
          icon="check"
          disabled={busy}
          onClick={() => void updateStatus(booking, "confirmed")}
        >
          Confirm
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="x"
          disabled={busy}
          onClick={() => void updateStatus(booking, "rejected")}
        >
          Reject
        </Button>
      </>
    ) : undefined;
  const openCreate = () => {
    setDraft(freshForm(String(customers[0]?.id ?? "")));
    setCreating(true);
  };
  const tone = (status: ApiBookingStatus) =>
    status === "completed"
      ? "success"
      : closedStatuses.includes(status)
        ? "danger"
        : status === "checked_in" || status === "pending"
          ? "warning"
          : status === "in_progress"
            ? "purple"
            : "info";

  return (
    <div className="operational-workspace">
      <PageHeader
        title="Bookings"
        action={
          <>
            <FreshnessBar
              updatedAt={updatedAt}
              loading={loading}
              error={loadError}
              onRefresh={() => setRefreshVersion((value) => value + 1)}
            />
            {branchControl}
            <Button
              icon="plus"
              disabled={loading || !customers.length || !services.some((service) => service.active)}
              onClick={openCreate}
            >
              New booking
            </Button>
          </>
        }
      />
      {awaiting.length > 0 && (
        <Panel className="operational-panel bookings-approval">
          <div className="bookings-approval__head">
            <div>
              <h2>Awaiting approval</h2>
              <p>
                {awaiting.length} customer request{awaiting.length === 1 ? "" : "s"} to confirm or
                reject. Each request holds its time slot until you decide.
              </p>
            </div>
          </div>
          <div className="operational-card-grid">
            {awaiting.map((booking) => (
              <RecordCard
                key={booking.id}
                onOpen={() => openDetails(booking)}
                ariaLabel={`Open booking request from ${booking.customerName}`}
                actions={quickActions(booking)}
              >
                <div className="operational-card__header">
                  <h3>
                    {formatDate(booking.date, cardDate)} · {formatTime(booking.time)}
                  </h3>
                  <Badge tone="warning">Awaiting approval</Badge>
                </div>
                <div className="operational-card__identity">
                  <Avatar initials={createInitials(booking.customerName)} tone="slate" size="sm" />
                  <strong>{booking.customerName}</strong>
                </div>
                <p>
                  {booking.serviceName} · {booking.barberName}
                </p>
                <small>
                  #{booking.id} · {formatCurrency(booking.price)}
                  {booking.notes ? ` · “${booking.notes}”` : ""}
                </small>
              </RecordCard>
            ))}
          </div>
        </Panel>
      )}
      <Panel className="operational-panel bookings-panel">
        <div className="bookings-toolbar">
          <div className="bookings-toolbar__date">
            <IconButton label="Previous day" icon="chevronLeft" onClick={() => moveDate(-1)} />
            <TextField
              type="date"
              aria-label="Appointment date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                if (!event.target.value) setDayView(false);
              }}
            />
            <IconButton label="Next day" icon="chevronRight" onClick={() => moveDate(1)} />
            {date !== dateInputValue() && (
              <Button size="sm" variant="ghost" onClick={() => setDate(dateInputValue())}>
                Today
              </Button>
            )}
            {date && (
              <strong className="bookings-toolbar__label">
                {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-PH", {
                  timeZone: "UTC",
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </strong>
            )}
          </div>
          <div className="task-view-switch" role="group" aria-label="Booking presentation">
            <button
              type="button"
              className="desktop-day"
              aria-pressed={dayView}
              onClick={() => {
                setDayView(true);
                if (!date) setDate(dateInputValue());
              }}
            >
              Schedule
            </button>
            <button type="button" aria-pressed={!dayView} onClick={() => setDayView(false)}>
              Agenda
            </button>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search bookings"
          resultCount={loading || loadError ? undefined : visible.length}
          filters={
            <>
              <SelectField
                aria-label="Barber"
                value={barberFilter}
                onChange={(event) => setBarberFilter(event.target.value)}
              >
                <option value="">All barbers</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.firstName} {barber.lastName}
                  </option>
                ))}
              </SelectField>
              <SelectField
                aria-label="Status"
                value={tab}
                onChange={(event) => setTab(event.target.value)}
              >
                <option value="open">Open bookings</option>
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </SelectField>
              {(search || barberFilter || tab !== "open") && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setBarberFilter("");
                    setTab("open");
                  }}
                >
                  Reset filters
                </Button>
              )}
              {!dayView && date && (
                <Button variant="ghost" onClick={() => setDate("")}>
                  All dates
                </Button>
              )}
            </>
          }
        />
        {contextError && (
          <p role="alert" className="task-note">
            {contextError}
          </p>
        )}
        {loading && !updatedAt && <ScheduleSkeleton gridOnly label="Loading bookings" />}
        {(!loading || updatedAt) && !loadError && dayView && (
          <div className="booking-calendar">
            <DaySchedule
              bookings={visible}
              barbers={barbers.filter(
                (barber) => !barberFilter || String(barber.id) === barberFilter,
              )}
              context={context?.date === date ? context : null}
              date={date}
              onOpen={openDetails}
            />
          </div>
        )}
        <div className={dayView ? "booking-agenda" : ""}>
          {loading && !updatedAt ? null : loadError ? (
            <p role="alert">{loadError}</p>
          ) : !visible.length ? (
            <EmptyState icon="calendar" title="No bookings found" />
          ) : view === "cards" ? (
            <div className="operational-card-grid">
              {visible.map((booking) => (
                <RecordCard
                  key={booking.id}
                  onOpen={() => {
                    setSelected(booking);
                    setEditing(false);
                  }}
                  ariaLabel={`Open booking for ${booking.customerName}`}
                  actions={quickActions(booking)}
                >
                  <div className="operational-card__header">
                    <h3>
                      {date
                        ? formatTime(booking.time)
                        : `${formatDate(booking.date, cardDate)} · ${formatTime(booking.time)}`}
                    </h3>
                    <Badge tone={tone(booking.status)}>{label(booking.status)}</Badge>
                  </div>
                  <div className="operational-card__identity">
                    <Avatar
                      initials={createInitials(booking.customerName)}
                      tone="slate"
                      size="sm"
                    />
                    <strong>{booking.customerName}</strong>
                  </div>
                  <p>
                    {booking.serviceName} · {booking.barberName}
                  </p>
                  <small>
                    #{booking.id} · {formatCurrency(booking.price)}
                  </small>
                </RecordCard>
              ))}
            </div>
          ) : (
            <ResponsiveTable headers={["When", "Customer", "Service", "Barber", "Status"]}>
              {visible.map((booking) => (
                <tr
                  key={booking.id}
                  tabIndex={0}
                  onClick={() => {
                    setSelected(booking);
                    setEditing(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelected(booking);
                  }}
                >
                  <td>
                    {formatDate(booking.date)} · {formatTime(booking.time)}
                  </td>
                  <td>{booking.customerName}</td>
                  <td>{booking.serviceName}</td>
                  <td>{booking.barberName}</td>
                  <td>
                    <Badge tone={tone(booking.status)}>{label(booking.status)}</Badge>
                  </td>
                </tr>
              ))}
            </ResponsiveTable>
          )}
        </div>
      </Panel>
      <Modal open={creating} title="New booking" onClose={() => !busy && setCreating(false)}>
        {bookingForm}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title="Booking details"
        subtitle={selected ? `${selected.customerName} · #${selected.id}` : undefined}
        eyebrow="Appointment"
        onClose={() => {
          setSelected(null);
          setEditing(false);
        }}
      >
        {selected &&
          (editing ? (
            <DrawerSection eyebrow="Edit appointment" title="Update booking">
              {bookingForm}
            </DrawerSection>
          ) : (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials={createInitials(selected.customerName)} tone="slate" size="lg" />
                  <div>
                    <strong>{selected.customerName}</strong>
                    <span>{selected.customerEmail}</span>
                  </div>
                  <Badge tone={tone(selected.status)}>{label(selected.status)}</Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Appointment facts" title="Schedule snapshot">
                <div className="operational-drawer__facts">
                  <div>
                    <span>When</span>
                    <strong>
                      {formatDate(selected.date)} ·{" "}
                      {formatTimeRange(selected.time, selected.endTime)}
                    </strong>
                  </div>
                  <div>
                    <span>Service</span>
                    <strong>
                      {selected.serviceName} · {selected.durationMinutes ?? "?"} min
                    </strong>
                  </div>
                  <div>
                    <span>Barber</span>
                    <strong>{selected.barberName}</strong>
                  </div>
                  <div>
                    <span>Price</span>
                    <strong>{formatCurrency(selected.price)}</strong>
                  </div>
                  <div>
                    <span>Notes</span>
                    <strong>{selected.notes || "None"}</strong>
                  </div>
                </div>
              </DrawerSection>
              {selected.status !== "completed" && (
                <DrawerSection eyebrow="Actions" title="Manage appointment">
                  <div className="operational-drawer__actions">
                    {selected.status === "pending" && (
                      <>
                        <Button
                          icon="check"
                          disabled={busy}
                          onClick={() => void updateStatus(selected, "confirmed")}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="danger"
                          icon="x"
                          disabled={busy}
                          onClick={() => void updateStatus(selected, "rejected")}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openEdit(selected)}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                    {selected.status === "confirmed" && (
                      <>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openEdit(selected)}
                        >
                          Edit
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => void updateStatus(selected, "checked_in")}
                        >
                          Check In
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={
                            busy || !mayMarkNoShow(selected.date, selected.time, new Date(now))
                          }
                          onClick={() => void updateStatus(selected, "no_show")}
                        >
                          Mark No Show
                        </Button>
                      </>
                    )}
                    {selected.status === "checked_in" && (
                      <Button
                        disabled={busy}
                        onClick={() => void updateStatus(selected, "in_progress")}
                      >
                        Start Service
                      </Button>
                    )}
                    {selected.status === "in_progress" && (
                      <Button
                        disabled={busy}
                        onClick={() => void updateStatus(selected, "completed")}
                      >
                        Complete
                      </Button>
                    )}
                    {(selected.status === "confirmed" || selected.status === "checked_in") && (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => setPendingCancellation(selected)}
                      >
                        Cancel
                      </Button>
                    )}
                    {deletableStatuses.includes(selected.status) && (
                      <Button
                        variant="ghost"
                        icon="trash"
                        disabled={busy}
                        onClick={() => setPendingDeletion(selected)}
                      >
                        Remove booking
                      </Button>
                    )}
                  </div>
                  {selected.status === "confirmed" &&
                    !mayMarkNoShow(selected.date, selected.time, new Date(now)) && (
                      <p className="form-hint">
                        No Show becomes available at {formatTime(noShowFrom(selected))},{" "}
                        {BOOKING_GRACE_MINUTES} minutes after the appointment starts.
                      </p>
                    )}
                  {closedStatuses.includes(selected.status) && (
                    <p className="form-hint">
                      This booking no longer holds its time slot. Remove it to clear it from the
                      list.
                    </p>
                  )}
                </DrawerSection>
              )}
            </>
          ))}
      </DetailDrawer>
      <ConfirmDialog
        open={Boolean(pendingCancellation)}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        danger
        busy={busy}
        onClose={() => setPendingCancellation(null)}
        onConfirm={() => pendingCancellation && void updateStatus(pendingCancellation, "cancelled")}
      />
      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Remove this booking?"
        description="It will be permanently removed from the bookings list."
        confirmLabel="Remove booking"
        danger
        busy={busy}
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => pendingDeletion && void deleteBooking(pendingDeletion)}
      />
    </div>
  );
}
