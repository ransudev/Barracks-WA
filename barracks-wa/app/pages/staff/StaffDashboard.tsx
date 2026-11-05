"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { ReportBranchScope } from "@/app/components/ReportBranchScope";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiBarberAvailability, ApiBooking, ApiQueueEntry } from "@/app/lib/api";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import type { ViewId } from "@/app/types/domain";
import {
  createInitials,
  dateInputValue,
  formatCurrency,
  formatDate,
  formatTime,
} from "@/app/utils/format";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/app/components/ui";
import { FreshnessBar } from "@/app/components/operations/OperationalPrimitives";
import { Icon } from "@/app/components/ui/icons";
import { barberAvailabilityLabel, isBarberAvailable } from "@/app/utils/barber-availability";

function displayName(barber: ApiBarberAvailability) {
  return `${barber.firstName} ${barber.lastName}`.trim();
}

function dateString(date = new Date()) {
  return dateInputValue(date);
}

type DashboardProps = { go: (view: ViewId) => void; onToast: (message: string) => void };
export function StaffDashboard(props: DashboardProps) {
  return (
    <ReportBranchScope>
      {(branch, branchControl) => (
        <StaffDashboardContent
          key={branch}
          {...props}
          branch={branch}
          branchControl={branchControl}
        />
      )}
    </ReportBranchScope>
  );
}
function StaffDashboardContent({
  go,
  onToast,
  branch,
  branchControl,
}: DashboardProps & { branch: string; branchControl: ReactNode }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [queue, setQueue] = useState<ApiQueueEntry[]>([]);
  const [queueAsOf, setQueueAsOf] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [barberResponse, bookingResponse] = await Promise.all([
          apiRequest(`/api/barbers?branchId=${branch}`, { cache: "no-store" }),
          apiRequest(`/api/bookings?branchId=${branch}`, { cache: "no-store" }),
        ]);
        const barberBody = await readApiBody<{
          success: boolean;
          barbers?: ApiBarberAvailability[];
          message?: string;
        }>(barberResponse);
        const bookingBody = await readApiBody<{
          success: boolean;
          bookings?: ApiBooking[];
          message?: string;
        }>(bookingResponse);
        if (!barberResponse.ok || !barberBody?.success || !barberBody.barbers)
          throw new Error(barberBody?.message ?? "Unable to load barbers");
        if (!bookingResponse.ok || !bookingBody?.success)
          throw new Error(bookingBody?.message ?? "Unable to load bookings");
        if (cancelled) return;
        setBarbers(barberBody.barbers);
        setBookings(bookingBody.bookings ?? []);
        setLoadError("");
        setUpdatedAt(Date.now());
      } catch (error) {
        if (!cancelled) {
          const message = errorMessage(error, "Unable to load dashboard");
          setLoadError(message);
          onToast(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadQueue() {
      setQueueLoading(true);
      try {
        const response = await apiRequest(`/api/queue?view=active&branchId=${branch}`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          queue?: ApiQueueEntry[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !body.queue)
          throw new Error(body?.message ?? "Unable to load queue");
        if (!cancelled) {
          setQueue(body.queue);
          setQueueAsOf(Date.now());
          setQueueError("");
        }
      } catch (error) {
        if (!cancelled) setQueueError(errorMessage(error, "Unable to load queue"));
      } finally {
        if (!cancelled) setQueueLoading(false);
      }
    }

    void load();
    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [onToast, branch, refreshVersion]);

  const today = dateString();
  const todayBookings = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.date === today && !["cancelled", "rejected"].includes(booking.status),
      ),
    [bookings, today],
  );
  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter(
          (booking) => ["pending", "confirmed"].includes(booking.status) && booking.date >= today,
        )
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [bookings, today],
  );
  const activeBarbers = barbers.filter(isBarberAvailable).length;
  const activeQueue = queue.filter((entry) =>
    ["waiting", "ready", "in_progress"].includes(entry.status),
  );

  return (
    <div className="staff-dashboard">
      <PageHeader
        title="Dashboard"
        action={
          <>
            <FreshnessBar
              updatedAt={updatedAt && queueAsOf ? Math.min(updatedAt, queueAsOf) : null}
              loading={loading || queueLoading}
              error={loadError || queueError}
              onRefresh={() => setRefreshVersion((value) => value + 1)}
            />
            {branchControl}
            <Button icon="scissors" onClick={() => go("barbers")}>
              View barber floor
            </Button>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Customers in queue"
          value={queueLoading || queueError ? "—" : String(activeQueue.length)}
          change={queueError ? "Unable to load queue" : undefined}
          changeTone="warning"
          icon="queue"
          accent="blue"
        />
        <MetricCard
          label="Today’s bookings"
          value={loading || loadError ? "—" : String(todayBookings.length)}
          icon="calendar"
          accent="amber"
        />
        <MetricCard
          label="Available barbers"
          value={loading || loadError ? "—" : String(activeBarbers)}
          icon="scissors"
          accent="green"
        />
        <MetricCard
          label="Ready to serve"
          value={
            queueLoading || queueError
              ? "—"
              : String(activeQueue.filter((entry) => entry.status === "ready").length)
          }
          icon="check"
          accent="violet"
        />
      </div>

      <div className="dashboard-grid dashboard-grid--wide">
        <Panel className="queue-preview">
          <SectionHeading
            title="Today’s queue"
            action={
              <Button variant="ghost" size="sm" iconAfter="arrowRight" onClick={() => go("queue")}>
                View all
              </Button>
            }
          />
          {queueLoading ? (
            <SkeletonRows count={3} label="Loading queue" />
          ) : queueError ? (
            <p role="alert" className="staff-table__empty">
              {queueError}
            </p>
          ) : activeQueue.length ? (
            <div className="queue-preview__list">
              {activeQueue.slice(0, 3).map((entry) => (
                <button
                  type="button"
                  className="queue-preview__row"
                  key={entry.id}
                  onClick={() => go("queue")}
                >
                  <span className="queue-number">#{entry.id}</span>
                  <Avatar initials={createInitials(entry.customerName)} tone="slate" size="sm" />
                  <span className="queue-preview__name">
                    <strong>{entry.customerName}</strong>
                    <small>
                      {entry.serviceName} · {entry.barberName ?? "Awaiting barber"}
                    </small>
                  </span>
                  <span
                    className={`queue-stage queue-stage--${entry.status === "in_progress" ? "active" : entry.status === "ready" ? "ready" : "waiting"}`}
                  >
                    {entry.status === "in_progress"
                      ? "In progress"
                      : entry.status === "ready"
                        ? "Ready"
                        : "Waiting"}
                  </span>
                  <span className="queue-preview__wait">
                    {entry.status === "in_progress"
                      ? "Serving"
                      : `${Math.max(0, Math.floor((queueAsOf - Date.parse(entry.joinedAt)) / 60_000))}m`}
                  </span>
                  <Icon name="arrowRight" size={15} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="queue"
              title="No customers in queue"
              description="Check in an appointment or add a walk-in from Queue management."
            />
          )}
        </Panel>

        <Panel className="schedule-preview">
          <SectionHeading
            title="Upcoming bookings"
            action={
              <Button
                variant="ghost"
                size="sm"
                iconAfter="arrowRight"
                onClick={() => go("bookings")}
              >
                View all
              </Button>
            }
          />
          <div className="schedule-list">
            {loading ? (
              <SkeletonRows count={3} label="Loading bookings" />
            ) : loadError ? (
              <div className="staff-table__empty">{loadError}</div>
            ) : upcomingBookings.length ? (
              upcomingBookings.slice(0, 3).map((booking, index) => (
                <div
                  className={`schedule-row ${index === 0 ? "is-priority" : ""}`}
                  key={booking.id}
                >
                  <span className="schedule-row__time">
                    <strong>{formatTime(booking.time)}</strong>
                    <small>
                      {formatDate(booking.date, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </span>
                  <span className="schedule-row__line" aria-hidden="true" />
                  <span>
                    <strong>{booking.customerName}</strong>
                    <small>
                      {booking.serviceName} · {booking.barberName}
                      {booking.status === "pending" ? " · Awaiting approval" : ""}
                    </small>
                  </span>
                  <strong className="schedule-row__price">{formatCurrency(booking.price)}</strong>
                </div>
              ))
            ) : (
              <EmptyState
                icon="calendar"
                title="No upcoming bookings"
                description="Scheduled appointments will appear here."
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="quick-actions quick-actions--supporting" aria-label="Dashboard quick actions">
        <button type="button" onClick={() => go("customers")}>
          <span className="quick-actions__icon quick-actions__icon--blue">
            <Icon name="userPlus" size={17} />
          </span>
          <span>
            <strong>Register customer</strong>
            <small>Add a new customer account</small>
          </span>
          <Icon name="arrowRight" size={15} />
        </button>
        <button type="button" onClick={() => go("bookings")}>
          <span className="quick-actions__icon quick-actions__icon--green">
            <Icon name="calendar" size={17} />
          </span>
          <span>
            <strong>New booking</strong>
            <small>Reserve a time for a customer</small>
          </span>
          <Icon name="arrowRight" size={15} />
        </button>
        <button type="button" onClick={() => go("queue")}>
          <span className="quick-actions__icon quick-actions__icon--red">
            <Icon name="queue" size={17} />
          </span>
          <span>
            <strong>Open queue</strong>
            <small>Assign barbers and move visits forward</small>
          </span>
          <Icon name="arrowRight" size={15} />
        </button>
      </div>

      <details className="barber-dashboard-details">
        <summary>Barber roster overview</summary>
        <Panel className="barber-dashboard-panel">
          <SectionHeading title="Live barber overview" />
          <div className="barber-status-grid">
            {loading ? (
              <SkeletonRows count={3} label="Loading barber profiles" />
            ) : loadError ? (
              <div className="staff-table__empty">{loadError}</div>
            ) : barbers.length ? (
              barbers.map((barber) => {
                const name = displayName(barber);
                return (
                  <article className="barber-status-card" key={barber.id}>
                    <div className="barber-status-card__head">
                      <Avatar initials={createInitials(name)} tone="slate" size="md" />
                      <Badge
                        tone={
                          isBarberAvailable(barber)
                            ? "success"
                            : barber.operationalAvailability?.reason === "serving_customer"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {barberAvailabilityLabel(barber)}
                      </Badge>
                    </div>
                    <strong>{name}</strong>
                    <div className="barber-status-card__stats">
                      <span>
                        <small>Status</small>
                        <strong>{barberAvailabilityLabel(barber)}</strong>
                      </span>
                      <span>
                        <small>Ready assignments</small>
                        <strong>
                          {queueLoading || queueError
                            ? "—"
                            : queue.filter(
                                (entry) => entry.barberId === barber.id && entry.status === "ready",
                              ).length}
                        </strong>
                      </span>
                    </div>
                  </article>
                );
              })
            ) : (
              <EmptyState
                icon="scissors"
                title="No barber profiles"
                description="Barbers will appear here when the roster is set up."
              />
            )}
          </div>
        </Panel>
      </details>
    </div>
  );
}
