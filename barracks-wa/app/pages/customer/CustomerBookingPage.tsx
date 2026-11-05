"use client";
import { SkeletonForm } from "@/app/components/ui/Skeletons";

import { useEffect, useState, type FormEvent } from "react";
import { BookingForm, type BookingFormValue } from "@/app/components/bookings/BookingForm";
import { Button, EmptyState, Panel, SectionHeading, SelectField } from "@/app/components/ui";
import type { ApiBarberAvailability, ApiBooking, ApiUser } from "@/app/lib/api";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import type { Service, ViewId } from "@/app/types/domain";
import { CustomerTopbar } from "@/app/pages/customer/CustomerTopbar";
import { formatDate, formatTime, formatTimeRange } from "@/app/utils/format";
import type { CustomerBranch } from "@/app/types/branch";

type CustomerHours = { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean };

type CustomerBookingProps = {
  go: (view: ViewId) => void;
  onToast: (message: string) => void;
  onSignOut: () => void;
  user: ApiUser;
};

export function CustomerBookingPage(props: CustomerBookingProps) {
  const [branches, setBranches] = useState<CustomerBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const storageKey = `barracks:customer-booking-branch:${props.user.id}`;
  const { onToast } = props;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await apiRequest("/api/customer-branches", { cache: "no-store" });
        const body = await readApiBody<{
          success: boolean;
          branches?: CustomerBranch[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Unable to load branches");
        if (!active) return;
        const available = body.branches ?? [];
        let remembered: number | null = null;
        try {
          remembered = Number(sessionStorage.getItem(storageKey));
        } catch {
          /* Storage is optional. */
        }
        setBranches(available);
        setBranchId(
          available.find((branch) => branch.id === remembered)?.id ??
            available.find((branch) => branch.code === "MAIN")?.id ??
            null,
        );
      } catch (error) {
        if (active) onToast(errorMessage(error, "Unable to load branches"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [storageKey, onToast]);
  function selectBranch(id: number) {
    setBranchId(id);
    try {
      sessionStorage.setItem(storageKey, String(id));
    } catch {
      /* Storage is optional. */
    }
  }
  const branch = branches.find((item) => item.id === branchId);
  if (branch)
    return (
      <CustomerBookingWorkspace
        key={`${props.user.id}:${branch.id}`}
        {...props}
        branch={branch}
        branches={branches}
        selectBranch={selectBranch}
      />
    );
  return (
    <div className="customer-page customer-page--dashboard customer-booking-view">
      <CustomerTopbar
        go={props.go}
        active="customer-booking"
        onSignOut={props.onSignOut}
        user={props.user}
      />
      <main className="customer-content">
        <div className="customer-dashboard__heading booking-heading">
          <h1>Book an appointment</h1>
          {!loading && branches.length > 0 && (
            <SelectField
              className="booking-branch-field"
              label="Booking branch"
              value=""
              onChange={(event) => selectBranch(Number(event.target.value))}
            >
              <option value="">Choose a branch</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        <Panel className="booking-form-card">
          {loading ? (
            <SkeletonForm fields={3} label="Loading branches" />
          ) : branches.length ? (
            <p className="booking-loading">Choose a branch to see services and available times.</p>
          ) : (
            <EmptyState
              icon="calendar"
              title="No branches available"
              description="Online booking is unavailable right now."
            />
          )}
        </Panel>
      </main>
    </div>
  );
}

function CustomerBookingWorkspace({
  go,
  onToast,
  onSignOut,
  user,
  branch,
  branches,
  selectBranch,
}: CustomerBookingProps & {
  branch: CustomerBranch;
  branches: CustomerBranch[];
  selectBranch: (id: number) => void;
}) {
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<CustomerHours[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<ApiBooking | null>(null);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [value, setValue] = useState<BookingFormValue>({
    customerId: "",
    serviceId: "",
    barberId: "",
    date: "",
    time: "",
    notes: "",
  });

  const selectedService = services.find((service) => service.id === value.serviceId);
  const selectedBarber = barbers.find((barber) => String(barber.id) === String(value.barberId));

  useEffect(() => {
    let active = true;
    async function loadBarbers() {
      try {
        const query = `?branchId=${branch.id}`;
        const [response, serviceResponse, hoursResponse] = await Promise.all([
          apiRequest(`/api/barbers${query}`),
          apiRequest(`/api/services${query}`, { cache: "no-store" }),
          apiRequest(`/api/shop-hours${query}`),
        ]);
        const body = await readApiBody<{
          success: boolean;
          barbers?: ApiBarberAvailability[];
          message?: string;
        }>(response);
        const serviceBody = await readApiBody<{
          success: boolean;
          services?: Service[];
          message?: string;
        }>(serviceResponse);
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Unable to load barbers");
        if (!serviceResponse.ok || !serviceBody?.success)
          throw new Error(serviceBody?.message ?? "Unable to load services");
        const hoursBody = await readApiBody<{
          success: boolean;
          hours?: CustomerHours[];
          message?: string;
        }>(hoursResponse);
        if (!hoursResponse.ok || !hoursBody?.success)
          throw new Error(hoursBody?.message ?? "Unable to load branch hours");
        if (!active) return;
        setHours(hoursBody.hours ?? []);
        const available = (body.barbers ?? []).filter((barber) => barber.status !== "unavailable");
        setBarbers(available);
        setServices(serviceBody.services ?? []);
        setValue((current) => ({
          ...current,
          serviceId:
            current.serviceId || serviceBody.services?.find((service) => service.active)?.id || "",
        }));
      } catch (error) {
        if (active) onToast(errorMessage(error, "Unable to load barbers"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadBarbers();
    return () => {
      active = false;
    };
  }, [onToast, branch.id]);

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.serviceId || !value.barberId || !value.date || !value.time) {
      onToast("Choose a service, barber, date, and available time");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiRequest(`/api/bookings?branchId=${branch.id}`, {
        method: "POST",
        body: JSON.stringify({
          serviceId: value.serviceId,
          barberId: Number(value.barberId),
          date: value.date,
          time: value.time,
          notes: value.notes,
        }),
      });
      const body = await readApiBody<{ success: boolean; booking?: ApiBooking; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.booking)
        throw new Error(body?.message ?? "Unable to create booking");
      setConfirmation(body.booking);
    } catch (error) {
      onToast(errorMessage(error, "Unable to create booking"));
      setValue((current) => ({ ...current, time: "" }));
      setAvailabilityVersion((current) => current + 1);
    } finally {
      setSubmitting(false);
    }
  }

  const dayHours = value.date
    ? hours.find((day) => day.dayOfWeek === new Date(`${value.date}T00:00:00Z`).getUTCDay())
    : undefined;
  const barberName = selectedBarber
    ? `${selectedBarber.firstName} ${selectedBarber.lastName}`
    : "Choose a barber";

  return (
    <div className="customer-page customer-page--dashboard customer-booking-view">
      <CustomerTopbar go={go} active="customer-booking" onSignOut={onSignOut} user={user} />
      <main className="customer-content">
        <div className="customer-dashboard__heading booking-heading">
          <h1>
            {confirmation
              ? confirmation.status === "pending"
                ? "Request sent"
                : "Appointment confirmed"
              : "Book an appointment"}
          </h1>
          {!confirmation && (
            <SelectField
              className="booking-branch-field"
              label="Booking branch"
              value={branch.id}
              disabled={submitting}
              onChange={(event) => selectBranch(Number(event.target.value))}
            >
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="booking-workspace-grid">
          <Panel className="booking-form-card">
            {confirmation ? (
              <div className="booking-confirmation" role="status">
                {confirmation.status === "pending" && (
                  <p className="booking-confirmation__note">
                    Your time is held while the shop reviews your request. You will see it marked
                    Confirmed under My appointments once staff approve it.
                  </p>
                )}
                <dl className="booking-facts">
                  <div>
                    <dt>Booking</dt>
                    <dd>#{confirmation.id}</dd>
                  </div>
                  <div>
                    <dt>Service</dt>
                    <dd>{confirmation.serviceName}</dd>
                  </div>
                  <div>
                    <dt>Barber</dt>
                    <dd>{confirmation.barberName}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{formatDate(confirmation.date)}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatTimeRange(confirmation.time, confirmation.endTime)}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{confirmation.branchName ?? branch.name}</dd>
                  </div>
                  {confirmation.notes && (
                    <div>
                      <dt>Notes</dt>
                      <dd>{confirmation.notes}</dd>
                    </div>
                  )}
                  <div className="booking-facts__total">
                    <dt>Total</dt>
                    <dd>₱{confirmation.price.toLocaleString()}</dd>
                  </div>
                </dl>
                <div className="modal-actions">
                  <Button onClick={() => go("customer-dashboard")}>View my appointments</Button>
                </div>
              </div>
            ) : loading ? (
              <SkeletonForm fields={4} label="Loading available barbers" />
            ) : barbers.length ? (
              <BookingForm
                branchId={branch.id}
                value={value}
                services={services}
                barbers={barbers}
                hideCustomer
                requireBarber
                submitLabel="Request appointment"
                submitting={submitting}
                availabilityVersion={availabilityVersion}
                onChange={setValue}
                onSubmit={createBooking}
                onCancel={() => go("customer-dashboard")}
              />
            ) : (
              <EmptyState
                icon="scissors"
                title="No barbers available"
                description="Choose another branch or check back shortly."
              />
            )}
          </Panel>

          {!confirmation && (
            <Panel className="booking-summary-card">
              <SectionHeading title="Summary" />
              <dl className="booking-facts">
                <div>
                  <dt>Service</dt>
                  <dd>{selectedService?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {selectedService?.durationMinutes
                      ? `${selectedService.durationMinutes} min`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Barber</dt>
                  <dd>{barberName}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{value.date ? formatDate(value.date) : "—"}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{formatTime(value.time)}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>
                    {branch.name}
                    {branch.address && <small>{branch.address}</small>}
                    {dayHours && (
                      <small>
                        {dayHours.isClosed
                          ? "Closed on this date"
                          : `Open ${formatTimeRange(dayHours.openTime, dayHours.closeTime)}`}
                      </small>
                    )}
                  </dd>
                </div>
                <div className="booking-facts__total">
                  <dt>Total</dt>
                  <dd>₱{selectedService?.price.toLocaleString() ?? "0"}</dd>
                </div>
              </dl>
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}
