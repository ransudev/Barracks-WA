"use client";
import { SkeletonCards } from "@/app/components/ui/Skeletons";

import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiRequest,
  readApiBody,
  type ApiAttendance,
  type ApiBarberAvailability,
  type ApiQueueEntry,
  errorMessage,
} from "@/app/lib/api";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  SelectField,
} from "@/app/components/ui";
import { createInitials } from "@/app/utils/format";
import { barberAvailabilityLabel, isBarberAvailable } from "@/app/utils/barber-availability";

function barberName(barber: ApiBarberAvailability): string {
  return `${barber.firstName} ${barber.lastName}`.trim();
}

const manilaTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";

export function BarberFloorPage() {
  const { branches, branchId, setBranchId, branchError } = useBranchContext();
  const loadVersion = useRef(0);
  const invalidateLoad = useCallback(() => {
    ++loadVersion.current;
  }, []);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [queue, setQueue] = useState<ApiQueueEntry[]>([]);
  const [attendance, setAttendance] = useState<ApiAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState("");
  const [attendanceSavingId, setAttendanceSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!branchId) {
      setBarbers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [barberResponse, queueResponse, attendanceResponse] = await Promise.all([
        apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" }),
        apiRequest(`/api/queue?view=active&branchId=${branchId}`, { cache: "no-store" }),
        apiRequest(`/api/attendance/today?branchId=${branchId}`, { cache: "no-store" }),
      ]);
      const [barberBody, queueBody, attendanceBody] = await Promise.all([
        readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[]; message?: string }>(
          barberResponse,
        ),
        readApiBody<{ success: boolean; queue?: ApiQueueEntry[]; message?: string }>(queueResponse),
        readApiBody<{ success: boolean; attendance?: ApiAttendance[]; message?: string }>(
          attendanceResponse,
        ),
      ]);
      if (!barberResponse.ok || !barberBody?.success || !barberBody.barbers)
        throw new Error(barberBody?.message ?? "Unable to load barbers");
      if (!queueResponse.ok || !queueBody?.success || !queueBody.queue)
        throw new Error(queueBody?.message ?? "Unable to load the current queue");
      if (!attendanceResponse.ok || !attendanceBody?.success || !attendanceBody.attendance)
        throw new Error(attendanceBody?.message ?? "Unable to load attendance");
      if (version !== loadVersion.current) return;
      setBarbers(barberBody.barbers);
      setQueue(queueBody.queue);
      setAttendance(attendanceBody.attendance);
      setError("");
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(errorMessage(cause, "Unable to load the barber floor"));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      invalidateLoad();
      window.cancelAnimationFrame(frame);
    };
  }, [load, invalidateLoad]);

  async function changeStatus(
    barber: ApiBarberAvailability,
    status: ApiBarberAvailability["status"],
  ) {
    setSavingId(barber.id);
    setStatusError("");
    try {
      const response = await apiRequest(`/api/barbers/${barber.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const body = await readApiBody<{
        success: boolean;
        barber?: ApiBarberAvailability;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.barber)
        throw new Error(body?.message ?? "Unable to update barber status");
      await load();
    } catch (cause) {
      setStatusError(errorMessage(cause, "Unable to update barber status"));
    } finally {
      setSavingId(null);
    }
  }

  async function changeAttendance(
    barberId: number,
    action:
      { action: "mark"; status: ApiAttendance["status"] } | { action: "clock_in" | "clock_out" },
  ) {
    setAttendanceSavingId(barberId);
    setStatusError("");
    try {
      const response = await apiRequest(`/api/attendance/today/${barberId}?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify(action),
      });
      const body = await readApiBody<{
        success: boolean;
        attendance?: ApiAttendance;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.attendance)
        throw new Error(body?.message ?? "Unable to update attendance");
      await load();
    } catch (cause) {
      setStatusError(errorMessage(cause, "Unable to update attendance"));
    } finally {
      setAttendanceSavingId(null);
    }
  }

  const serving = queue.filter(
    (entry) =>
      entry.status === "in_progress" && barbers.some((barber) => barber.id === entry.barberId),
  );
  const available = barbers.filter(
    (barber) => isBarberAvailable(barber) && !serving.some((entry) => entry.barberId === barber.id),
  );

  return (
    <div className="operational-workspace">
      {branchError && <p role="alert">{branchError}</p>}
      <PageHeader
        title="Barber Floor"
        action={
          <>
            <BranchSwitcher
              branches={branches}
              value={branchId}
              disabled={savingId !== null || attendanceSavingId !== null}
              onChange={(id) => {
                invalidateLoad();
                setBarbers([]);
                setQueue([]);
                setAttendance([]);
                setLoading(true);
                setError("");
                setStatusError("");
                setBranchId(id);
              }}
            />
            <Button
              icon="refresh"
              variant="secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Barbers"
          value={loading || error ? "—" : String(barbers.length)}
          icon="scissors"
          accent="blue"
        />
        <MetricCard
          label="Available"
          value={loading || error ? "—" : String(available.length)}
          icon="check"
          accent="green"
        />
        <MetricCard
          label="In service"
          value={loading || error ? "—" : String(serving.length)}
          icon="queue"
          accent="amber"
        />
        <MetricCard
          label="Unavailable"
          value={
            loading || error
              ? "—"
              : String(
                  barbers.filter(
                    (barber) =>
                      !isBarberAvailable(barber) &&
                      !serving.some((entry) => entry.barberId === barber.id),
                  ).length,
                )
          }
          icon="info"
          accent="violet"
        />
      </div>
      <Panel className="operational-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>Barber availability</h2>
          </div>
        </div>
        {statusError && (
          <p className="operational-loading" role="alert">
            {statusError}
          </p>
        )}
        {loading ? (
          <SkeletonCards count={4} label="Loading barber floor" />
        ) : error ? (
          <p className="operational-loading" role="alert">
            {error}
          </p>
        ) : !barbers.length ? (
          <EmptyState
            icon="scissors"
            title="No barbers found"
            description="Barbers are added by a manager or administrator under Barbers. Ask them to add barbers to this branch."
          />
        ) : (
          <div className="barber-status-grid">
            {barbers.map((barber) => {
              const name = barberName(barber);
              const currentService = serving.find((entry) => entry.barberId === barber.id);
              const readyCount = queue.filter(
                (entry) => entry.barberId === barber.id && entry.status === "ready",
              ).length;
              const today = attendance.find((entry) => entry.barberId === barber.id);
              const status = currentService ? "In service" : barberAvailabilityLabel(barber);
              const tone = currentService
                ? "warning"
                : isBarberAvailable(barber)
                  ? "success"
                  : "neutral";
              return (
                <article className="barber-status-card" key={barber.id}>
                  <div className="barber-status-card__head">
                    <Avatar initials={createInitials(name)} tone="slate" size="md" />
                    <Badge tone={tone}>{status}</Badge>
                  </div>
                  <strong>{name}</strong>
                  <div className="barber-status-card__stats">
                    <span>
                      <small>Current service</small>
                      <strong>
                        {currentService
                          ? `${currentService.customerName} · ${currentService.serviceName}`
                          : "None"}
                      </strong>
                    </span>
                    <span>
                      <small>Ready assignments</small>
                      <strong>{readyCount}</strong>
                    </span>
                  </div>
                  <SelectField
                    label="Operational status"
                    aria-label={`Operational status for ${name}`}
                    value={barber.status}
                    disabled={savingId === barber.id}
                    onChange={(event) =>
                      void changeStatus(
                        barber,
                        event.target.value as ApiBarberAvailability["status"],
                      )
                    }
                  >
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="unavailable">Unavailable</option>
                  </SelectField>
                  <div className="barber-attendance-controls">
                    <span className="field__label">Attendance today</span>
                    <Badge
                      tone={
                        today?.status === "present"
                          ? "success"
                          : today?.status === "late"
                            ? "warning"
                            : today?.status === "absent"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {today ? today.status : "Unmarked"}
                    </Badge>
                    <p>
                      Clock In: {manilaTime(today?.clockIn ?? null)} · Clock Out:{" "}
                      {manilaTime(today?.clockOut ?? null)}
                    </p>
                    <div className="barber-attendance-actions">
                      {(["present", "late", "absent"] as const).map((attendanceStatus) => (
                        <Button
                          key={attendanceStatus}
                          size="sm"
                          variant="secondary"
                          disabled={
                            attendanceSavingId === barber.id ||
                            today?.status === attendanceStatus ||
                            (attendanceStatus === "absent" && Boolean(today?.clockIn))
                          }
                          onClick={() =>
                            void changeAttendance(barber.id, {
                              action: "mark",
                              status: attendanceStatus,
                            })
                          }
                        >
                          Mark {attendanceStatus}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={attendanceSavingId === barber.id || Boolean(today?.clockIn)}
                        onClick={() => void changeAttendance(barber.id, { action: "clock_in" })}
                      >
                        Clock In
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          attendanceSavingId === barber.id ||
                          !today?.clockIn ||
                          Boolean(today.clockOut) ||
                          Boolean(currentService)
                        }
                        onClick={() => void changeAttendance(barber.id, { action: "clock_out" })}
                      >
                        Clock Out
                      </Button>
                      {currentService && today?.clockIn && !today.clockOut && (
                        <p>Complete the active service before clocking out.</p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
