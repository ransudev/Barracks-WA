"use client";
import { CustomerDashboardSkeleton, SkeletonForm } from "@/app/components/ui/Skeletons";

import { emailFieldError, phoneFieldError } from "@/app/utils/contact-validation";
import { useEffect, useState, type FormEvent } from "react";
import { BookingForm, type BookingFormValue } from "@/app/components/bookings/BookingForm";
import type { ApiBarberAvailability, ApiBooking, ApiCustomer, ApiUser } from "@/app/lib/api";
import { apiRequest, peekApiBody, readApiBody } from "@/app/lib/api";
import type { Service, ViewId } from "@/app/types/domain";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  Modal,
  Pagination,
  Panel,
  SectionHeading,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { createInitials, formatDate, formatTime, formatTimeRange } from "@/app/utils/format";
import { CustomerTopbar } from "@/app/pages/customer/CustomerTopbar";

type ProfileDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredBarberId: string;
};

function profileForm(customer: ApiCustomer): ProfileDraft {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    preferredBarberId: customer.preferredBarberId ? String(customer.preferredBarberId) : "",
  };
}

const upcomingLabel: Record<string, string> = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_progress: "In progress",
};
const historyLabel: Record<string, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Declined by shop",
  no_show: "No show",
  pending: "Not confirmed",
  confirmed: "Not attended",
};

function formatMemberSince(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function bookingFormValue(booking: ApiBooking): BookingFormValue {
  return {
    customerId: String(booking.customerId),
    serviceId: booking.serviceId,
    barberId: String(booking.barberId),
    date: booking.date,
    time: booking.time,
    notes: booking.notes ?? "",
  };
}

const HISTORY_PAGE_SIZE = 5;

export function CustomerDashboard({
  go,
  onToast,
  onSignOut,
  user,
}: {
  go: (view: ViewId) => void;
  onToast: (message: string) => void;
  onSignOut: () => void;
  user: ApiUser;
}) {
  // Show the last loaded account at once while it refreshes in the background.
  const [customer, setCustomer] = useState<ApiCustomer | null>(
    () => peekApiBody<{ customer?: ApiCustomer }>("/api/customers/me")?.customer ?? null,
  );
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>(
    () => peekApiBody<{ barbers?: ApiBarberAvailability[] }>("/api/barbers")?.barbers ?? [],
  );
  const [bookingBarbers, setBookingBarbers] = useState<ApiBarberAvailability[]>([]);
  const [bookingServices, setBookingServices] = useState<Service[]>([]);
  const [bookingChoicesLoading, setBookingChoicesLoading] = useState(false);
  const [bookings, setBookings] = useState<ApiBooking[]>(
    () => peekApiBody<{ bookings?: ApiBooking[] }>("/api/bookings")?.bookings ?? [],
  );
  const [draft, setDraft] = useState<ProfileDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    preferredBarberId: "",
  });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(() => !peekApiBody("/api/customers/me"));
  const [saving, setSaving] = useState(false);
  const [editingBooking, setEditingBooking] = useState<ApiBooking | null>(null);
  const [bookingDraft, setBookingDraft] = useState<BookingFormValue | null>(null);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [pendingCancellation, setPendingCancellation] = useState<ApiBooking | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [customerResponse, bookingResponse, barberResponse] = await Promise.all([
          apiRequest("/api/customers/me"),
          apiRequest("/api/bookings"),
          apiRequest("/api/barbers"),
        ]);
        const customerBody = await readApiBody<{
          success: boolean;
          customer?: ApiCustomer;
          message?: string;
        }>(customerResponse);
        const bookingBody = await readApiBody<{
          success: boolean;
          bookings?: ApiBooking[];
          message?: string;
        }>(bookingResponse);
        const barberBody = await readApiBody<{
          success: boolean;
          barbers?: ApiBarberAvailability[];
        }>(barberResponse);

        if (!customerResponse.ok || !customerBody?.success || !customerBody.customer) {
          throw new Error(customerBody?.message ?? "Unable to load customer dashboard");
        }
        if (!bookingResponse.ok || !bookingBody?.success) {
          throw new Error(bookingBody?.message ?? "Unable to load appointments");
        }

        setCustomer(customerBody.customer);
        setDraft(profileForm(customerBody.customer));
        setBookings(bookingBody.bookings ?? []);
        if (barberResponse.ok && barberBody?.success) setBarbers(barberBody.barbers ?? []);
      } catch (error) {
        onToast(error instanceof Error ? error.message : "Unable to load customer dashboard");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [onToast]);

  useEffect(() => {
    if (!editingBooking) return;
    let active = true;
    const branchQuery = editingBooking.branchId ? `?branchId=${editingBooking.branchId}` : "";
    async function loadChoices() {
      setBookingChoicesLoading(true);
      try {
        const [response, serviceResponse] = await Promise.all([
          apiRequest(`/api/barbers${branchQuery}`),
          apiRequest(`/api/services${branchQuery}`),
        ]);
        const body = await readApiBody<{
          success: boolean;
          barbers?: ApiBarberAvailability[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Unable to load appointment barbers");
        const serviceBody = await readApiBody<{
          success: boolean;
          services?: Service[];
          message?: string;
        }>(serviceResponse);
        if (!serviceResponse.ok || !serviceBody?.success)
          throw new Error(serviceBody?.message ?? "Unable to load appointment services");
        if (active) {
          setBookingBarbers(body.barbers ?? []);
          setBookingServices(serviceBody.services ?? []);
        }
      } catch (error) {
        if (active)
          onToast(error instanceof Error ? error.message : "Unable to load appointment barbers");
      } finally {
        if (active) setBookingChoicesLoading(false);
      }
    }
    void loadChoices();
    return () => {
      active = false;
    };
  }, [editingBooking, onToast]);

  function openProfileEditor() {
    if (!customer) return;
    setDraft(profileForm(customer));
    setEditing(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      const response = await apiRequest("/api/customers/me", {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          preferredBarberId: draft.preferredBarberId ? Number(draft.preferredBarberId) : null,
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        customer?: ApiCustomer;
        message?: string;
      }>(response);

      if (!response.ok || !body?.success || !body.customer) {
        throw new Error(body?.message ?? "Unable to update your profile");
      }

      setCustomer(body.customer);
      setDraft(profileForm(body.customer));
      setEditing(false);
      onToast("Profile updated");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to update your profile");
    } finally {
      setSaving(false);
    }
  }

  function openBookingEditor(booking: ApiBooking) {
    setBookingBarbers([]);
    setBookingServices([]);
    setBookingChoicesLoading(true);
    setEditingBooking(booking);
    setBookingDraft(bookingFormValue(booking));
  }

  async function saveBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBooking || !bookingDraft) return;
    if (!bookingDraft.barberId) {
      onToast("Choose a barber");
      return;
    }
    setBookingSaving(true);

    try {
      const response = await apiRequest(`/api/bookings/${editingBooking.id}`, {
        method: "PUT",
        body: JSON.stringify({
          serviceId: bookingDraft.serviceId,
          barberId: Number(bookingDraft.barberId),
          date: bookingDraft.date,
          time: bookingDraft.time,
          notes: bookingDraft.notes,
        }),
      });
      const body = await readApiBody<{ success: boolean; booking?: ApiBooking; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.booking) {
        throw new Error(body?.message ?? "Unable to update your appointment");
      }
      setBookings((current) =>
        current.map((booking) => (booking.id === body.booking!.id ? body.booking! : booking)),
      );
      setEditingBooking(null);
      setBookingDraft(null);
      onToast(
        body.booking.status === "pending"
          ? "Appointment updated. The shop will confirm the new time."
          : "Appointment updated",
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to update your appointment");
      setBookingDraft((current) => (current ? { ...current, time: "" } : current));
      setAvailabilityVersion((current) => current + 1);
    } finally {
      setBookingSaving(false);
    }
  }

  async function cancelBooking(booking: ApiBooking) {
    setCancellingBookingId(booking.id);

    try {
      const response = await apiRequest(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });
      const body = await readApiBody<{ success: boolean; booking?: ApiBooking; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.booking) {
        throw new Error(body?.message ?? "Unable to cancel your appointment");
      }
      setBookings((current) =>
        current.map((item) => (item.id === body.booking!.id ? body.booking! : item)),
      );
      setPendingCancellation(null);
      onToast("Appointment cancelled");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to cancel your appointment");
    } finally {
      setCancellingBookingId(null);
    }
  }

  const name = customer
    ? `${customer.firstName} ${customer.lastName}`
    : `${user.firstName} ${user.lastName}`;
  // Upcoming = still active and not yet over, soonest first. Appointments whose time has
  // passed without a visit move to history so the next real appointment is always on top.
  const isOver = (booking: ApiBooking) =>
    Date.parse(`${booking.date}T${booking.endTime ?? booking.time}:00+08:00`) < now;
  const isActive = (booking: ApiBooking) =>
    ["pending", "confirmed", "checked_in", "in_progress"].includes(booking.status);
  const upcoming = bookings
    .filter(
      (booking) =>
        isActive(booking) &&
        (booking.status === "checked_in" || booking.status === "in_progress" || !isOver(booking)),
    )
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const past = bookings
    .filter((booking) => !upcoming.includes(booking))
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
  const completedCount = past.filter((booking) => booking.status === "completed").length;
  const historyPageCount = Math.max(1, Math.ceil(past.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const historyRows = past.slice(
    (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
    currentHistoryPage * HISTORY_PAGE_SIZE,
  );

  return (
    <div className="customer-page customer-page--dashboard">
      <CustomerTopbar go={go} active="customer-dashboard" onSignOut={onSignOut} user={user} />
      <main className="customer-content">
        <div className="customer-dashboard">
          <div className="customer-dashboard__heading">
            <div>
              <h1>Welcome back, {name.split(" ")[0]}.</h1>
            </div>
            <Button icon="calendar" onClick={() => go("customer-booking")}>
              Book appointment
            </Button>
          </div>

          {loading ? (
            <CustomerDashboardSkeleton />
          ) : customer ? (
            <>
              <div className="metrics-grid metrics-grid--three">
                <MetricCard
                  label="Loyalty points"
                  value={String(customer.loyaltyPoints)}
                  icon="spark"
                  accent="amber"
                />
                <MetricCard
                  label="Upcoming"
                  value={String(upcoming.length)}
                  icon="calendar"
                  accent="blue"
                />
                <MetricCard
                  label="Completed visits"
                  value={String(completedCount)}
                  icon="check"
                  accent="green"
                />
              </div>

              <div className="customer-dashboard__grid">
                <Panel className="customer-summary-panel">
                  <SectionHeading
                    title="Your profile"
                    action={
                      <button className="link-button" type="button" onClick={openProfileEditor}>
                        Edit details
                      </button>
                    }
                  />
                  <div className="customer-summary">
                    <Avatar
                      initials={createInitials(name)}
                      tone="slate"
                      size="lg"
                      className="customer-dashboard__avatar"
                    />
                    <div>
                      <strong>{name}</strong>
                      <span>{customer.loyaltyPoints} loyalty points</span>
                    </div>
                  </div>
                  <dl className="customer-profile-facts">
                    <div>
                      <dt>Email</dt>
                      <dd title={customer.email}>{customer.email}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{customer.phone || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Preferred barber</dt>
                      <dd>{customer.preferredBarberName ?? "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Member since</dt>
                      <dd>{formatMemberSince(customer.createdAt)}</dd>
                    </div>
                  </dl>
                </Panel>

                <Panel className="customer-bookings-panel matched-height-panel">
                  <SectionHeading
                    title="Upcoming appointments"
                    action={
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => go("customer-booking")}
                      >
                        Book
                      </button>
                    }
                  />
                  <div
                    className="panel-scroll-body"
                    role="region"
                    aria-label="Upcoming appointments"
                    tabIndex={0}
                  >
                    {upcoming.length ? (
                      <div className="customer-booking-list">
                        {upcoming.map((booking) => (
                          <div className="customer-booking-card" key={booking.id}>
                            <div className="customer-booking-card__content">
                              <strong>{formatDate(booking.date)}</strong>
                              <span>
                                {formatTimeRange(booking.time, booking.endTime)} ·{" "}
                                {booking.serviceName}
                              </span>
                              <small>
                                with {booking.barberName} · {booking.branchName ?? "Main Branch"}
                              </small>
                            </div>
                            <div className="customer-booking-card__actions">
                              <Badge
                                tone={
                                  booking.status === "pending"
                                    ? "warning"
                                    : booking.status === "confirmed"
                                      ? "success"
                                      : "info"
                                }
                              >
                                {upcomingLabel[booking.status] ?? booking.status}
                              </Badge>
                              {["pending", "confirmed"].includes(booking.status) && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon="edit"
                                  onClick={() => openBookingEditor(booking)}
                                >
                                  Manage
                                </Button>
                              )}
                              {["pending", "confirmed"].includes(booking.status) && (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => setPendingCancellation(booking)}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon="calendar" title="No upcoming appointments" />
                    )}
                  </div>
                </Panel>
              </div>

              <Panel className="customer-history-panel">
                <SectionHeading title="Appointment history" />
                {past.length ? (
                  <>
                    <div className="customer-booking-list">
                      {historyRows.map((booking) => (
                        <div
                          className="customer-booking-card customer-booking-card--history"
                          key={booking.id}
                        >
                          <strong>{formatDate(booking.date)}</strong>
                          <span>{booking.serviceName}</span>
                          <span>{booking.barberName}</span>
                          <small>{booking.branchName ?? "Main Branch"}</small>
                          <Badge
                            tone={
                              booking.status === "completed"
                                ? "success"
                                : booking.status === "pending" || booking.status === "confirmed"
                                  ? "neutral"
                                  : "danger"
                            }
                          >
                            {historyLabel[booking.status] ?? booking.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      page={currentHistoryPage}
                      pageCount={historyPageCount}
                      onPageChange={setHistoryPage}
                      summary={`${past.length} past appointment${past.length === 1 ? "" : "s"}`}
                    />
                  </>
                ) : (
                  <p className="customer-history-panel__empty">No past appointments yet.</p>
                )}
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState
                icon="users"
                title="Account unavailable"
                description="Your customer details could not be loaded. Sign out, then sign in again to reload them."
                action={
                  <Button variant="secondary" icon="logOut" onClick={onSignOut}>
                    Sign out
                  </Button>
                }
              />
            </Panel>
          )}
        </div>
      </main>

      <Modal
        open={Boolean(editingBooking && bookingDraft)}
        title="Update your appointment"
        onClose={() => !bookingSaving && setEditingBooking(null)}
      >
        <p>Branch: {editingBooking?.branchName ?? "Main Branch"}</p>
        {bookingChoicesLoading && <SkeletonForm fields={4} label="Loading appointment barbers" />}
        {bookingDraft && !bookingChoicesLoading && (
          <BookingForm
            key={editingBooking?.id}
            branchId={editingBooking?.branchId}
            value={bookingDraft}
            services={bookingServices}
            barbers={bookingBarbers.filter((barber) => barber.status !== "unavailable")}
            hideCustomer
            requireBarber
            excludeBookingId={editingBooking?.id}
            availabilityVersion={availabilityVersion}
            submitLabel="Save appointment"
            submitting={bookingSaving}
            onChange={setBookingDraft}
            onSubmit={saveBooking}
            onCancel={() => setEditingBooking(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingCancellation)}
        title="Cancel this appointment?"
        description={
          pendingCancellation
            ? `${formatDate(pendingCancellation.date)} at ${formatTime(pendingCancellation.time)} will be marked cancelled.`
            : undefined
        }
        confirmLabel="Cancel appointment"
        danger
        busy={cancellingBookingId !== null}
        onClose={() => cancellingBookingId === null && setPendingCancellation(null)}
        onConfirm={() => pendingCancellation && void cancelBooking(pendingCancellation)}
      />

      <Modal open={editing} title="Edit your profile" onClose={() => !saving && setEditing(false)}>
        <form className="modal-form" onSubmit={saveProfile}>
          <div className="form-grid form-grid--two">
            <TextField
              label="First name"
              value={draft.firstName}
              onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
            />
            <TextField
              label="Last name"
              value={draft.lastName}
              onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}
            />
          </div>
          <TextField
            label="Email address"
            type="email"
            value={draft.email}
            error={emailFieldError(draft.email)}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            icon="mail"
          />
          <TextField
            label="Phone number"
            type="tel"
            inputMode="numeric"
            maxLength={11}
            value={draft.phone}
            error={phoneFieldError(draft.phone)}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            icon="phone"
          />
          <SelectField
            label="Preferred barber"
            value={draft.preferredBarberId}
            onChange={(event) => setDraft({ ...draft, preferredBarberId: event.target.value })}
          >
            <option value="">Not set</option>
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.firstName} {barber.lastName}
              </option>
            ))}
          </SelectField>
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" icon="check" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
