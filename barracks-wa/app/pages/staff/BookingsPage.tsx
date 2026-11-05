"use client";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BookingForm, type BookingFormValue } from "@/app/components/bookings/BookingForm";
import type { ApiBooking, ApiBookingStatus } from "@/app/lib/api";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import { ScheduleSkeleton } from "@/app/components/ui/Skeletons";
import {
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
import { dateInputValue } from "@/app/utils/format";
import { FreshnessBar, FilterToolbar } from "@/app/components/operations/OperationalPrimitives";
import { DaySchedule } from "@/app/components/bookings/DaySchedule";
import { hasAppointmentCustomer } from "@/app/utils/booking-customers";
import { AwaitingApprovalPanel } from "./bookings/AwaitingApprovalPanel";
import { BookingCards } from "./bookings/BookingCards";
import { BookingDetailDrawer } from "./bookings/BookingDetailDrawer";
import {
  bookingPayload,
  closedStatuses,
  formFromBooking,
  freshForm,
  label,
  statuses,
  statusMessages,
} from "./bookings/model";
import { useBookingsData } from "./bookings/useBookingsData";

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
  const [tab, setTab] = useState("open");
  const [date, setDate] = useState(dateInputValue);
  const [barberFilter, setBarberFilter] = useState("");
  const [dayView, setDayView] = useState(true);
  const {
    items,
    setItems,
    customers,
    barbers,
    services,
    loading,
    loadError,
    updatedAt,
    context,
    contextError,
    refresh,
  } = useBookingsData(branchId, date);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApiBooking | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<BookingFormValue>(freshForm());
  const [busy, setBusy] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [pendingCancellation, setPendingCancellation] = useState<ApiBooking | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<ApiBooking | null>(null);

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
      onToast(errorMessage(error, "Unable to save booking"));
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
      onToast(errorMessage(error, "Unable to update booking"));
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
      onToast(errorMessage(error, "Unable to delete booking"));
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
              onRefresh={refresh}
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
        <AwaitingApprovalPanel
          awaiting={awaiting}
          quickActions={quickActions}
          onOpen={openDetails}
        />
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
          ) : (
            <BookingCards
              bookings={visible}
              showDate={!date}
              quickActions={quickActions}
              onOpen={openDetails}
            />
          )}
        </div>
      </Panel>
      <Modal open={creating} title="New booking" onClose={() => !busy && setCreating(false)}>
        {bookingForm}
      </Modal>
      <BookingDetailDrawer
        selected={selected}
        editing={editing}
        form={bookingForm}
        busy={busy}
        onClose={() => {
          setSelected(null);
          setEditing(false);
        }}
        onUpdateStatus={updateStatus}
        onEdit={openEdit}
        onCancel={setPendingCancellation}
        onRemove={setPendingDeletion}
      />
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
