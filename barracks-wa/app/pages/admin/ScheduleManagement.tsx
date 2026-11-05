"use client";

import { formatTimeRange } from "@/app/utils/format";
import { useEffect, useState } from "react";
import type { ApiBarber } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { Button, Panel, SelectField, Tabs } from "@/app/components/ui";

type Hours = { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean };
type Break = { startTime: string; endTime: string };
type Shift = {
  dayOfWeek: number;
  isWorking: boolean;
  startTime: string;
  endTime: string;
  breaks: Break[];
};
type Absence = { id: number; startsAt: string; endsAt: string; reason: string };
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const timeInput = (value: string, onChange: (value: string) => void) => (
  <input type="time" value={value} onChange={(event) => onChange(event.target.value)} />
);

export function ScheduleManagement({
  branchId,
  barbers,
  onToast,
}: {
  branchId: number;
  barbers: ApiBarber[];
  onToast: (message: string) => void;
}) {
  const [section, setSection] = useState("shifts");
  const [selectedDay, setSelectedDay] = useState(1);
  const [hoursError, setHoursError] = useState("");
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hours, setHours] = useState<Hours[]>([]);
  const [barberId, setBarberId] = useState(0);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedBarberId, setLoadedBarberId] = useState(0);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const response = await apiRequest(`/api/shop-hours?branchId=${branchId}`, {
            cache: "no-store",
          });
          const body = await readApiBody<{ hours?: Hours[]; message?: string }>(response);
          if (!response.ok || !body?.hours)
            throw new Error(body?.message ?? "Unable to load hours");
          setHours(body.hours);
        } catch (cause) {
          setHoursError(cause instanceof Error ? cause.message : "Unable to load hours");
        } finally {
          setHoursLoading(false);
        }
      })();
    });
    return () => window.cancelAnimationFrame(id);
  }, [branchId]);
  useEffect(() => {
    let active = true;
    const id = window.requestAnimationFrame(() => {
      void (async () => {
        setLoadedBarberId(0);
        if (!barberId) {
          setShifts([]);
          setAbsences([]);
          return;
        }
        try {
          const response = await apiRequest(`/api/barbers/${barberId}/schedule`, {
            cache: "no-store",
          });
          const body = await readApiBody<{
            schedules?: Shift[];
            unavailability?: Absence[];
            message?: string;
          }>(response);
          if (!response.ok || !body?.schedules)
            throw new Error(body?.message ?? "Unable to load schedule");
          if (!active) return;
          setShifts(body.schedules);
          setAbsences(body.unavailability ?? []);
          setError("");
          setLoadedBarberId(barberId);
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : "Unable to load schedule");
        }
      })();
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(id);
    };
  }, [barberId]);
  async function saveHour(hour: Hours) {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest(`/api/shop-hours?branchId=${branchId}`, {
        method: "PUT",
        body: JSON.stringify(hour),
      });
      const body = await readApiBody<{ hours?: Hours[]; message?: string }>(response);
      if (!response.ok || !body?.hours) throw new Error(body?.message ?? "Unable to save hours");
      setHours(body.hours);
      onToast(`${days[hour.dayOfWeek]} shop hours saved`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save hours");
    } finally {
      setBusy(false);
    }
  }
  async function saveShift(shift: Shift) {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest(`/api/barbers/${barberId}/schedule`, {
        method: "PUT",
        body: JSON.stringify(shift),
      });
      const body = await readApiBody<{
        schedules?: Shift[];
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.schedules)
        throw new Error(
          Object.values(body?.errors ?? {})
            .flat()
            .join(" ") ||
            body?.message ||
            "Unable to save shift",
        );
      setShifts(body.schedules);
      onToast(`${days[shift.dayOfWeek]} shift saved`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save shift");
    } finally {
      setBusy(false);
    }
  }
  async function addAbsence() {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest(`/api/barbers/${barberId}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          startsAt: new Date(`${start}:00+08:00`).toISOString(),
          endsAt: new Date(`${end}:00+08:00`).toISOString(),
          reason,
        }),
      });
      const body = await readApiBody<{ unavailability?: Absence; message?: string }>(response);
      if (!response.ok || !body?.unavailability)
        throw new Error(body?.message ?? "Unable to add absence");
      setAbsences((current) => [...current, body.unavailability!]);
      setStart("");
      setEnd("");
      setReason("");
      onToast("Unavailable period added");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the dates and reason");
    } finally {
      setBusy(false);
    }
  }
  async function removeAbsence(id: number) {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest(`/api/barbers/${barberId}/schedule?periodId=${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Unable to remove period");
      setAbsences((current) => current.filter((item) => item.id !== id));
      onToast("Unavailable period removed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove period");
    } finally {
      setBusy(false);
    }
  }
  const updateHour = (day: number, patch: Partial<Hours>) =>
    setHours((current) =>
      current.map((item) => (item.dayOfWeek === day ? { ...item, ...patch } : item)),
    );
  const updateShift = (day: number, patch: Partial<Shift>) =>
    setShifts((current) =>
      current.map((item) => (item.dayOfWeek === day ? { ...item, ...patch } : item)),
    );
  return (
    <Panel className="operational-panel schedule-management">
      <div className="inventory-catalog-head">
        <div>
          <h2>Barber schedules</h2>
        </div>
        <span className="schedule-management__timezone">Asia/Manila</span>
      </div>
      {error && (
        <p role="alert" className="form-error schedule-management__error">
          {error}
        </p>
      )}

      <Tabs
        active={section}
        onChange={setSection}
        items={[
          { id: "shifts", label: "Weekly shifts" },
          { id: "hours", label: "Shop hours" },
        ]}
      />
      {section === "hours" && (
        <div className="schedule-management__section">
          <div className="schedule-management__section-head">
            <div>
              <h3>Shop operating hours</h3>
            </div>
          </div>
          {hoursLoading && <p role="status">Loading shop hours…</p>}
          {hoursError && (
            <p role="alert" className="form-error">
              {hoursError}
            </p>
          )}
          <div className="schedule-management__rows">
            {hours.map((hour) => (
              <div className="schedule-management__row" key={hour.dayOfWeek}>
                <strong className="schedule-management__day">{days[hour.dayOfWeek]}</strong>
                <label className="schedule-management__toggle">
                  <input
                    type="checkbox"
                    checked={hour.isClosed}
                    onChange={(event) =>
                      updateHour(hour.dayOfWeek, { isClosed: event.target.checked })
                    }
                  />{" "}
                  Closed
                </label>
                <label className="schedule-management__time">
                  <span>Opens</span>
                  {timeInput(hour.openTime, (value) =>
                    updateHour(hour.dayOfWeek, { openTime: value }),
                  )}
                </label>
                <label className="schedule-management__time">
                  <span>Closes</span>
                  {timeInput(hour.closeTime, (value) =>
                    updateHour(hour.dayOfWeek, { closeTime: value }),
                  )}
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void saveHour(hour)}
                >
                  Save
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === "shifts" && (
        <div className="schedule-management__section">
          <div className="schedule-management__section-head">
            <div>
              <h3>Barber schedule</h3>
              <p>Choose a barber to manage working days, breaks, and time away.</p>
            </div>
            <SelectField
              label="Barber"
              className="schedule-management__barber-select"
              value={barberId}
              disabled={busy}
              onChange={(event) => {
                setLoadedBarberId(0);
                setShifts([]);
                setAbsences([]);
                setBarberId(Number(event.target.value));
              }}
            >
              <option value={0}>Select barber</option>
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.firstName} {barber.lastName}
                </option>
              ))}
            </SelectField>
          </div>
          {barberId !== 0 && loadedBarberId !== barberId && !error && (
            <p role="status">Loading weekly shifts…</p>
          )}
          {barberId === 0 ? (
            <p className="schedule-management__empty">
              Select a barber to see their weekly schedule.
            </p>
          ) : loadedBarberId !== barberId ? null : (
            <>
              <div className="weekly-timeline" aria-label="Weekly shift timeline">
                {[1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
                  const shift = shifts.find((item) => item.dayOfWeek === dayOfWeek);
                  return (
                    <button
                      type="button"
                      key={dayOfWeek}
                      aria-pressed={selectedDay === dayOfWeek}
                      onClick={() => setSelectedDay(dayOfWeek)}
                    >
                      <strong>{days[dayOfWeek]}</strong>
                      <span>
                        {!shift
                          ? "Not configured"
                          : shift.isWorking
                            ? formatTimeRange(shift.startTime, shift.endTime)
                            : "Scheduled off"}
                      </span>
                      <span className="weekly-timeline__track" aria-hidden="true">
                        {shift?.isWorking && (
                          <>
                            <i
                              style={{
                                left: `${(minute(shift.startTime) / 1440) * 100}%`,
                                width: `${((minute(shift.endTime) - minute(shift.startTime)) / 1440) * 100}%`,
                              }}
                            />
                            {shift.breaks.map((pause, index) => (
                              <b
                                key={index}
                                style={{
                                  left: `${((Number(pause.startTime.slice(0, 2)) * 60 + Number(pause.startTime.slice(3))) / 1440) * 100}%`,
                                  width: `${((Number(pause.endTime.slice(0, 2)) * 60 + Number(pause.endTime.slice(3)) - (Number(pause.startTime.slice(0, 2)) * 60 + Number(pause.startTime.slice(3)))) / 1440) * 100}%`,
                                }}
                              />
                            ))}
                          </>
                        )}
                      </span>
                      <small>
                        {shift?.breaks.length
                          ? shift.breaks
                              .map(
                                (pause) =>
                                  `Break ${formatTimeRange(pause.startTime, pause.endTime)}`,
                              )
                              .join(" · ")
                          : "No recorded breaks"}
                      </small>
                    </button>
                  );
                })}
              </div>
              {loadedBarberId === barberId && shifts.length < 7 && (
                <p role="alert" className="form-hint schedule-management__hint">
                  This barber needs a complete weekly schedule. Save each missing day before taking
                  appointments for it.
                </p>
              )}
              <div
                className="schedule-management__rows"
                aria-label={`Edit ${days[selectedDay]} shift`}
              >
                {days.map((day, dayOfWeek) => {
                  if (dayOfWeek !== selectedDay) return null;
                  const shift = shifts.find((item) => item.dayOfWeek === dayOfWeek) ?? {
                    dayOfWeek,
                    isWorking: false,
                    startTime:
                      hours.find((item) => item.dayOfWeek === dayOfWeek)?.openTime ?? "09:00",
                    endTime:
                      hours.find((item) => item.dayOfWeek === dayOfWeek)?.closeTime ?? "19:30",
                    breaks: [],
                  };
                  const update = (patch: Partial<Shift>) => {
                    if (!shifts.some((item) => item.dayOfWeek === dayOfWeek))
                      setShifts((current) => [...current, { ...shift, ...patch }]);
                    else updateShift(dayOfWeek, patch);
                  };
                  return (
                    <div className="schedule-management__row" key={day}>
                      <strong className="schedule-management__day">{day}</strong>
                      <label className="schedule-management__toggle">
                        <input
                          type="checkbox"
                          checked={shift.isWorking}
                          onChange={(event) => update({ isWorking: event.target.checked })}
                        />{" "}
                        Working
                      </label>
                      <label className="schedule-management__time">
                        <span>Starts</span>
                        {timeInput(shift.startTime, (value) => update({ startTime: value }))}
                      </label>
                      <label className="schedule-management__time">
                        <span>Ends</span>
                        {timeInput(shift.endTime, (value) => update({ endTime: value }))}
                      </label>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || loadedBarberId !== barberId}
                        onClick={() => void saveShift(shift)}
                      >
                        Save shift
                      </Button>
                      <div className="schedule-management__breaks">
                        <span>Breaks</span>
                        {shift.breaks.map((item, index) => (
                          <div className="schedule-management__break" key={index}>
                            <label>
                              Break starts
                              {timeInput(item.startTime, (value) =>
                                update({
                                  breaks: shift.breaks.map((entry, i) =>
                                    i === index ? { ...entry, startTime: value } : entry,
                                  ),
                                }),
                              )}
                            </label>
                            <span>to</span>
                            <label>
                              Break ends
                              {timeInput(item.endTime, (value) =>
                                update({
                                  breaks: shift.breaks.map((entry, i) =>
                                    i === index ? { ...entry, endTime: value } : entry,
                                  ),
                                }),
                              )}
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                update({ breaks: shift.breaks.filter((_, i) => i !== index) })
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            update({
                              breaks: [...shift.breaks, { startTime: "12:00", endTime: "13:00" }],
                            })
                          }
                        >
                          Add break
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="schedule-management__absence">
                <div className="schedule-management__section-head">
                  <div>
                    <h3>Temporary unavailability</h3>
                    <p>Block time away from the shop without changing the weekly schedule.</p>
                  </div>
                </div>
                <div className="schedule-management__absence-form">
                  <label>
                    Start
                    <input
                      type="datetime-local"
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                    />
                  </label>
                  <label>
                    End
                    <input
                      type="datetime-local"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      value={reason}
                      maxLength={200}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      busy || loadedBarberId !== barberId || !start || !end || !reason.trim()
                    }
                    onClick={() => void addAbsence()}
                  >
                    Add period
                  </Button>
                </div>
                {absences.map((item) => (
                  <div className="schedule-management__absence-item" key={item.id}>
                    <span>
                      {new Date(item.startsAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}{" "}
                      – {new Date(item.endsAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
                    </span>
                    <span>{item.reason}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeAbsence(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
