"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  apiRequest,
  readApiBody,
  type ApiAttendance,
  type ApiAttendanceCorrection,
  type ApiBarberAvailability,
} from "@/app/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import {
  DetailDrawer,
  FreshnessBar,
  FilterToolbar,
  ResponsiveTable,
} from "@/app/components/operations/OperationalPrimitives";

import type { WeeklySchedule, Unavailability } from "@/server/services/schedule.service";

const todayInManila = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateTimeInManila = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(value))
        .replace(" ", "T")
    : "";
const clockLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const toInstant = (value: string) => (value ? new Date(`${value}:00+08:00`).toISOString() : null);
const shiftDate = (value: string, days: number) => {
  const next = new Date(`${value}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const startOfWeek = (value: string) =>
  shiftDate(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
const weekDateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

const cellText: Record<string, string> = {
  P: "Present",
  L: "Late",
  A: "Absent",
  U: "—",
  F: "",
  O: "Off",
  T: "Away",
};

export function AttendanceManagement() {
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
    return <AttendanceBranch key={branchId} branchId={branchId} branchControl={branchControl} />;
  return (
    <div className="operational-workspace attendance-workspace">
      <PageHeader title="Barber attendance" action={branchControl} />
      {branchError ? (
        <p role="alert">{branchError}</p>
      ) : branchLoading ? (
        <SkeletonRows count={6} label="Loading attendance" />
      ) : (
        <Panel>
          <EmptyState icon="calendar" title="No branch assigned" />
        </Panel>
      )}
    </div>
  );
}

function AttendanceBranch({
  branchId,
  branchControl,
}: {
  branchId: number;
  branchControl: ReactNode;
}) {
  const [view, setView] = useState("week");
  const [week, setWeek] = useState(() => startOfWeek(todayInManila()));
  const [search, setSearch] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    name: string;
    date: string;
    status: string;
  } | null>(null);
  const [scheduleData, setScheduleData] = useState<
    Record<number, { schedules: WeeklySchedule[]; unavailability: Unavailability[] }>
  >({});
  const [scheduleError, setScheduleError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyVersion = useRef(0);
  const loadVersion = useRef(0);
  const [records, setRecords] = useState<ApiAttendance[]>([]);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [date, setDate] = useState(todayInManila);
  const [barberId, setBarberId] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<ApiAttendance | null>(null);
  const [corrections, setCorrections] = useState<ApiAttendanceCorrection[]>([]);
  const [draftStatus, setDraftStatus] = useState<ApiAttendance["status"]>("present");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ branchId: String(branchId) });
      if (view === "week") {
        params.set("dateFrom", week);
        params.set("dateTo", shiftDate(week, 6));
      } else if (date) params.set("date", date);
      if (barberId) params.set("barberId", barberId);
      if (status && view !== "week") params.set("status", status);
      const [historyResponse, barbersResponse] = await Promise.all([
        apiRequest(`/api/attendance/history${params.size ? `?${params}` : ""}`, {
          cache: "no-store",
        }),
        apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" }),
      ]);
      const [historyBody, barbersBody] = await Promise.all([
        readApiBody<{ success: boolean; attendance?: ApiAttendance[]; message?: string }>(
          historyResponse,
        ),
        readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[]; message?: string }>(
          barbersResponse,
        ),
      ]);
      if (!historyResponse.ok || !historyBody?.success || !historyBody.attendance)
        throw new Error(historyBody?.message ?? "Unable to load attendance");
      if (!barbersResponse.ok || !barbersBody?.success || !barbersBody.barbers)
        throw new Error(barbersBody?.message ?? "Unable to load barbers");
      if (version !== loadVersion.current) return;
      setRecords(historyBody.attendance);
      setBarbers(barbersBody.barbers);
      setError("");
      setUpdatedAt(Date.now());
    } catch (cause) {
      if (version === loadVersion.current)
        setError(cause instanceof Error ? cause.message : "Unable to load attendance");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [branchId, date, barberId, status, week, view]);

  const invalidateLoad = useCallback(() => {
    ++loadVersion.current;
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      invalidateLoad();
      window.cancelAnimationFrame(frame);
    };
  }, [load, invalidateLoad]);

  useEffect(() => {
    let active = true;
    if (!barbers.length) return;
    void Promise.all(
      barbers.map(async (barber) => {
        const response = await apiRequest(`/api/barbers/${barber.id}/schedule`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          schedules: WeeklySchedule[];
          unavailability: Unavailability[];
        }>(response);
        if (!response.ok || !body?.success)
          throw new Error("Schedule context unavailable; unrecorded dates remain Unmarked.");
        return [barber.id, body] as const;
      }),
    )
      .then((rows) => {
        if (active) {
          setScheduleData(Object.fromEntries(rows));
          setScheduleError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setScheduleData({});
          setScheduleError(cause instanceof Error ? cause.message : "Schedule context unavailable");
        }
      });
    return () => {
      active = false;
    };
  }, [barbers]);

  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(week, index));
  const historyRoster = new Map<number, { id: number; firstName: string; lastName: string }>(
    barbers.map((barber) => [barber.id, barber]),
  );
  records.forEach((record) => {
    if (!historyRoster.has(record.barberId))
      historyRoster.set(record.barberId, {
        id: record.barberId,
        firstName: record.barberName,
        lastName: "",
      });
  });
  const historyBarbers = [...historyRoster.values()];
  const visibleBarbers = historyBarbers.filter(
    (barber) =>
      (!barberId || String(barber.id) === barberId) &&
      `${barber.firstName} ${barber.lastName}`.toLowerCase().includes(search.toLowerCase()) &&
      (!status ||
        records.some((record) => record.barberId === barber.id && record.status === status)),
  );
  const cellStatus = (id: number, day: string) => {
    const record = records.find((item) => item.barberId === id && item.date === day);
    if (record)
      return {
        record,
        label: record.status,
        symbol: record.status === "present" ? "P" : record.status === "late" ? "L" : "A",
      };
    if (day > todayInManila()) return { label: "Future", symbol: "F" };
    const schedule = scheduleData[id];
    const shift = schedule?.schedules.find(
      (item) => item.dayOfWeek === new Date(`${day}T12:00:00Z`).getUTCDay(),
    );
    const start = Date.parse(`${day}T00:00:00+08:00`);
    const end = start + 86400000;
    // A partial-day absence is context, not a conclusion about attendance.
    if (
      schedule?.unavailability.some(
        (away) => Date.parse(away.startsAt) <= start && Date.parse(away.endsAt) >= end,
      )
    )
      return { label: "Time away", symbol: "T" };
    if (shift && !shift.isWorking) return { label: "Scheduled off", symbol: "O" };
    return { label: "Unmarked", symbol: "U" };
  };
  const dailyRecords = records.filter(
    (record) =>
      record.barberName.toLowerCase().includes(search.toLowerCase()) &&
      (view !== "week" || visibleBarbers.some((barber) => barber.id === record.barberId)),
  );
  const moveWeek = (offset: number) => setWeek((current) => shiftDate(current, offset * 7));

  async function openRecord(record: ApiAttendance) {
    const version = ++historyVersion.current;
    setSelectedCell(null);
    setHistoryLoading(true);
    setDetailError("");
    setSelected(record);
    setDraftStatus(record.status);
    setClockIn(dateTimeInManila(record.clockIn));
    setClockOut(dateTimeInManila(record.clockOut));
    setReason("");
    setCorrections([]);
    setHistoryError("");
    try {
      const response = await apiRequest(`/api/attendance/${record.id}/corrections`, {
        cache: "no-store",
      });
      const body = await readApiBody<{
        success: boolean;
        corrections?: ApiAttendanceCorrection[];
        message?: string;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to load correction history");
      if (version === historyVersion.current) setCorrections(body.corrections ?? []);
    } catch (cause) {
      if (version === historyVersion.current)
        setHistoryError(
          cause instanceof Error ? cause.message : "Unable to load correction history",
        );
    } finally {
      if (version === historyVersion.current) setHistoryLoading(false);
    }
  }

  async function saveCorrection(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reason.trim()) {
      setDetailError("A correction reason is required");
      return;
    }
    setSaving(true);
    setDetailError("");
    try {
      const response = await apiRequest(`/api/attendance/${selected.id}/corrections`, {
        method: "POST",
        body: JSON.stringify({
          status: draftStatus,
          clockIn: toInstant(clockIn),
          clockOut: toInstant(clockOut),
          reason: reason.trim(),
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        attendance?: ApiAttendance;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.attendance)
        throw new Error(body?.message ?? "Unable to save correction");
      await load();
      setSelected(body.attendance);
      setReason("");
      const history = await apiRequest(`/api/attendance/${selected.id}/corrections`, {
        cache: "no-store",
      });
      const historyBody = await readApiBody<{
        success: boolean;
        corrections?: ApiAttendanceCorrection[];
        message?: string;
      }>(history);
      if (!history.ok || !historyBody?.success) {
        setHistoryError(
          "Correction saved, but history could not be refreshed. Reopen the record to retry.",
        );
      } else {
        setCorrections(historyBody.corrections ?? []);
        setHistoryError("");
      }
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Unable to save correction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="operational-workspace attendance-workspace">
      <PageHeader
        title="Barber attendance"
        action={
          <>
            <FreshnessBar
              updatedAt={updatedAt}
              loading={loading}
              error={!selected ? error : undefined}
              onRefresh={() => void load()}
            />
            {branchControl}
          </>
        }
      />
      <Panel className="operational-panel">
        <div className="bookings-toolbar">
          <div className="bookings-toolbar__date">
            {view === "week" ? (
              <>
                <IconButton label="Previous week" icon="chevronLeft" onClick={() => moveWeek(-1)} />
                <TextField
                  type="date"
                  aria-label="Week containing"
                  value={week}
                  onChange={(event) => {
                    if (event.target.value) setWeek(startOfWeek(event.target.value));
                  }}
                />
                <IconButton label="Next week" icon="chevronRight" onClick={() => moveWeek(1)} />
                {week !== startOfWeek(todayInManila()) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setWeek(startOfWeek(todayInManila()))}
                  >
                    This week
                  </Button>
                )}
                <strong className="bookings-toolbar__label">
                  {weekDateLabel(week)} – {weekDateLabel(shiftDate(week, 6))}
                </strong>
              </>
            ) : (
              <>
                <TextField
                  type="date"
                  aria-label="Date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
                <Button size="sm" variant="ghost" onClick={() => setDate(todayInManila())}>
                  Today
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDate("")}>
                  All dates
                </Button>
              </>
            )}
          </div>
          <div className="task-view-switch" role="group" aria-label="Attendance view">
            <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
              Week matrix
            </button>
            <button type="button" aria-pressed={view === "daily"} onClick={() => setView("daily")}>
              Daily list
            </button>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search barbers"
          resultCount={loading || error ? undefined : dailyRecords.length}
          onReset={() => {
            setSearch("");
            setBarberId("");
            setStatus("");
            setDate(todayInManila());
            setWeek(startOfWeek(todayInManila()));
          }}
          filters={
            <>
              <SelectField
                aria-label="Barber"
                value={barberId}
                onChange={(event) => setBarberId(event.target.value)}
              >
                <option value="">All barbers</option>
                {historyBarbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.firstName} {barber.lastName}
                  </option>
                ))}
              </SelectField>
              <SelectField
                aria-label={view === "week" ? "Barbers with status" : "Status"}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
              </SelectField>
            </>
          }
        />
        {scheduleError && view === "week" && (
          <p role="alert" className="task-note">
            {scheduleError}
          </p>
        )}
        {view === "week" && !loading && !error && (
          <div className="attendance-week">
            <div className="attendance-matrix-wrap">
              <table className="attendance-matrix">
                <thead>
                  <tr>
                    <th scope="col">Barber</th>
                    {dates.map((day) => (
                      <th
                        scope="col"
                        key={day}
                        className={day === todayInManila() ? "is-today" : undefined}
                      >
                        <span>{Number(day.slice(-2))}</span>
                        <small>
                          {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-PH", {
                            weekday: "short",
                            timeZone: "Asia/Manila",
                          })}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleBarbers.map((barber) => (
                    <tr key={barber.id}>
                      <th scope="row">
                        {barber.firstName} {barber.lastName}
                      </th>
                      {dates.map((day) => {
                        const cell = cellStatus(barber.id, day);
                        return (
                          <td
                            key={day}
                            className={day === todayInManila() ? "is-today" : undefined}
                          >
                            <button
                              type="button"
                              className={`attendance-cell attendance-cell--${cell.symbol}`}
                              aria-label={`${barber.firstName} ${barber.lastName}, ${day}, ${cell.label}`}
                              title={`${day} · ${cell.label}`}
                              onClick={() => {
                                if (cell.record) void openRecord(cell.record);
                                else {
                                  setSelected(null);
                                  setSelectedCell({
                                    name: `${barber.firstName} ${barber.lastName}`,
                                    date: day,
                                    status: cell.label,
                                  });
                                }
                              }}
                            >
                              {cellText[cell.symbol]}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visibleBarbers.length && (
              <EmptyState
                title="No matching barbers"
                description="Reset the filters to review the roster."
              />
            )}
          </div>
        )}
        <div className={view === "week" ? "attendance-mobile-list" : ""}>
          {error && !selected && (
            <p role="alert" className="operational-loading">
              {error}
            </p>
          )}
          {loading ? (
            <SkeletonRows count={6} label="Loading attendance" />
          ) : error ? null : dailyRecords.length === 0 ? (
            <EmptyState icon="calendar" title="No attendance records" />
          ) : (
            <ResponsiveTable
              headers={["Date", "Barber", "Attendance", "Clock In", "Clock Out", "Details"]}
            >
              {dailyRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.date}</td>
                  <td>{record.barberName}</td>
                  <td>
                    <Badge
                      tone={
                        record.status === "present"
                          ? "success"
                          : record.status === "late"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {record.status}
                    </Badge>
                  </td>
                  <td>{clockLabel(record.clockIn)}</td>
                  <td>{clockLabel(record.clockOut)}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => void openRecord(record)}>
                      View record
                    </Button>
                  </td>
                </tr>
              ))}
            </ResponsiveTable>
          )}
        </div>
      </Panel>
      <DetailDrawer
        open={Boolean(selected || selectedCell)}
        title={
          selected
            ? `${selected.barberName} · ${selected.date}`
            : selectedCell
              ? `${selectedCell.name} · ${selectedCell.date}`
              : "Attendance"
        }
        onClose={() => {
          if (saving) return;
          historyVersion.current++;
          setSelected(null);
          setSelectedCell(null);
          setDetailError("");
        }}
      >
        {selectedCell && (
          <>
            <p>
              Status: <strong>{selectedCell.status}</strong>
            </p>
            <p>
              No attendance record exists for this date. Clock times and correction history are
              unavailable. Today’s attendance is recorded on the Barber Floor.
            </p>
          </>
        )}
        {selected && (
          <div className="attendance-detail">
            <p>
              Recorded by staff #{selected.recordedBy} · Last updated by staff #{selected.updatedBy}
            </p>
            <p>
              Current: {selected.status} · In {clockLabel(selected.clockIn)} · Out{" "}
              {clockLabel(selected.clockOut)}
            </p>
            <form
              onSubmit={(event) => void saveCorrection(event)}
              className="attendance-correction-form"
            >
              <SelectField
                label="Corrected status"
                value={draftStatus}
                onChange={(event) => setDraftStatus(event.target.value as ApiAttendance["status"])}
              >
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
              </SelectField>
              <TextField
                label="Clock In (Manila)"
                type="datetime-local"
                value={clockIn}
                onChange={(event) => setClockIn(event.target.value)}
              />
              <TextField
                label="Clock Out (Manila)"
                type="datetime-local"
                value={clockOut}
                onChange={(event) => setClockOut(event.target.value)}
              />
              <TextField
                label="Correction reason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
              />
              {detailError && <p role="alert">{detailError}</p>}
              <Button type="submit" disabled={saving}>
                Save correction
              </Button>
            </form>
            <h3>Correction history</h3>
            {historyLoading ? (
              <p role="status">Loading correction history…</p>
            ) : historyError ? (
              <p role="alert">{historyError}</p>
            ) : corrections.length === 0 ? (
              <p>No corrections recorded.</p>
            ) : (
              corrections.map((entry) => (
                <div key={entry.id} className="attendance-audit-entry">
                  <strong>
                    {entry.correctedByName} · {clockLabel(entry.createdAt)}
                  </strong>
                  <p>{entry.reason}</p>
                  <p>
                    Before: {entry.previousValues.status},{" "}
                    {clockLabel(entry.previousValues.clockIn)} –{" "}
                    {clockLabel(entry.previousValues.clockOut)}
                  </p>
                  <p>
                    After: {entry.newValues.status}, {clockLabel(entry.newValues.clockIn)} –{" "}
                    {clockLabel(entry.newValues.clockOut)}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
