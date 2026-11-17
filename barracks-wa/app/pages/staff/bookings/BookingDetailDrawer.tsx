"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Avatar, Badge, Button, TextField } from "@/app/components/ui";
import { apiRequest, readApiBody } from "@/app/lib/api";
import type { BookingEvent } from "@/server/services/booking.service";
import { DetailDrawer, DrawerSection } from "@/app/components/operations/OperationalPrimitives";
import {
  BOOKING_GRACE_MINUTES,
  bookingHasStarted,
  isBookingDay,
  lateLabel,
  mayMarkNoShow,
  minutesLate,
} from "@/app/constants/booking";
import type { ApiBooking, ApiBookingStatus } from "@/app/lib/api";
import {
  createInitials,
  formatCurrency,
  formatDate,
  formatTime,
  formatTimeRange,
} from "@/app/utils/format";
import {
  closedStatuses,
  deletableStatuses,
  depositLabel,
  eventLabel,
  label,
  methodName,
  noShowFrom,
  paymentLabel,
  paymentTone,
  tone,
} from "./model";

export function BookingDetailDrawer({
  selected,
  editing,
  form,
  busy,
  onClose,
  onUpdateStatus,
  onEdit,
  onReject,
  onSaveRemarks,
  onCancel,
  onRemove,
}: {
  selected: ApiBooking | null;
  editing: boolean;
  form: ReactNode;
  busy: boolean;
  onClose: () => void;
  onUpdateStatus: (booking: ApiBooking, status: ApiBookingStatus) => Promise<void>;
  onEdit: (booking: ApiBooking) => void;
  // Rejecting and cancelling open a dialog that requires a reason.
  onReject: (booking: ApiBooking) => void;
  onSaveRemarks: (booking: ApiBooking, remarks: string) => Promise<void>;
  onCancel: (booking: ApiBooking) => void;
  // Omitted for Front Desk: only Management may permanently remove bookings.
  onRemove?: (booking: ApiBooking) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // Remarks draft and the event log follow the open booking and refresh after each change.
  const [remarks, setRemarks] = useState("");
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const selectedId = selected?.id;
  const selectedVersion = selected?.updatedAt;
  const selectedRemarks = selected?.remarks ?? "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemarks(selectedRemarks);
  }, [selectedId, selectedRemarks]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void apiRequest(`/api/bookings/${selectedId}`, { cache: "no-store" })
      .then((response) => readApiBody<{ success: boolean; events?: BookingEvent[] }>(response))
      .then((body) => {
        if (active) setEvents(body?.success ? (body.events ?? []) : []);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, [selectedId, selectedVersion, selectedRemarks]);
  const late =
    selected?.status === "confirmed" ? minutesLate(selected.date, selected.time, new Date(now)) : 0;

  return (
    <DetailDrawer
      open={Boolean(selected)}
      title="Booking details"
      subtitle={selected ? `${selected.customerName} · #${selected.id}` : undefined}
      eyebrow="Appointment"
      onClose={onClose}
    >
      {selected &&
        (editing ? (
          <DrawerSection eyebrow="Edit appointment" title="Update booking">
            {form}
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
              {late > 0 && (
                <p className="late-flag" role="status">
                  {lateLabel(late)}: past the scheduled time and not yet checked in.
                </p>
              )}
              {selected.statusReason && (
                <p className="status-reason">
                  <strong>
                    {selected.status === "rejected" ? "Rejection reason" : "Cancellation reason"}
                    {selected.closedBy === "customer" ? " (customer)" : ""}:
                  </strong>{" "}
                  {selected.statusReason}
                </p>
              )}
            </DrawerSection>
            <DrawerSection eyebrow="Appointment facts" title="Schedule snapshot">
              <div className="operational-drawer__facts">
                <div>
                  <span>When</span>
                  <strong>
                    {formatDate(selected.date)} · {formatTimeRange(selected.time, selected.endTime)}
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
                <div>
                  <span>Deposit</span>
                  <strong>
                    {selected.depositAmount > 0
                      ? `${formatCurrency(selected.depositAmount)} · ${methodName[selected.depositMethod ?? ""] ?? "—"}${selected.depositReference ? ` · Ref. ${selected.depositReference}` : ""}`
                      : "None"}
                  </strong>
                  {selected.depositAmount > 0 && (
                    <small>{depositLabel[selected.depositStatus]}</small>
                  )}
                </div>
                {selected.status === "completed" && selected.paymentStatus && (
                  <div>
                    <span>Payment</span>
                    <strong>
                      <Badge tone={paymentTone(selected.paymentStatus)}>
                        {paymentLabel[selected.paymentStatus]}
                      </Badge>
                    </strong>
                    {selected.paymentStatus !== "paid" && selected.paymentStatus !== "voided" && (
                      <small>
                        Balance {formatCurrency(Math.max(0, selected.price - selected.paidAmount))}{" "}
                        of {formatCurrency(selected.price)}. Collect it in Payments.
                      </small>
                    )}
                  </div>
                )}
              </div>
            </DrawerSection>
            <DrawerSection eyebrow="Appointment history" title="Remarks">
              <form
                className="remarks-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveRemarks(selected, remarks);
                }}
              >
                <TextField
                  aria-label="Remarks"
                  maxLength={500}
                  value={remarks}
                  placeholder="e.g. Customer asked for a skin fade next visit"
                  onChange={(event) => setRemarks(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={busy || remarks.trim() === (selected.remarks ?? "")}
                >
                  Save remarks
                </Button>
              </form>
              <p className="form-hint">Shown to the customer in their appointment history.</p>
            </DrawerSection>
            {selected.status !== "completed" && (
              <DrawerSection eyebrow="Actions" title="Manage appointment">
                <div className="operational-drawer__actions">
                  {selected.status === "pending" && (
                    <>
                      {!bookingHasStarted(selected.date, selected.time, new Date(now)) && (
                        <Button
                          icon="check"
                          disabled={busy}
                          onClick={() => void onUpdateStatus(selected, "confirmed")}
                        >
                          {selected.depositStatus === "submitted"
                            ? "Deposit verified · Confirm"
                            : "Confirm"}
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        icon="x"
                        disabled={busy}
                        onClick={() => onReject(selected)}
                      >
                        Reject
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => onEdit(selected)}>
                        Edit
                      </Button>
                    </>
                  )}
                  {selected.status === "confirmed" && (
                    <>
                      <Button variant="secondary" disabled={busy} onClick={() => onEdit(selected)}>
                        Edit
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          // Early or late arrivals are allowed, but confirm the date first.
                          if (
                            isBookingDay(selected.date, new Date(now)) ||
                            window.confirm(
                              `This appointment is on ${formatDate(selected.date)}, not today. Check the customer in anyway?`,
                            )
                          )
                            void onUpdateStatus(selected, "checked_in");
                        }}
                      >
                        Check In
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={
                          busy || !mayMarkNoShow(selected.date, selected.time, new Date(now))
                        }
                        onClick={() => void onUpdateStatus(selected, "no_show")}
                      >
                        Mark No Show
                      </Button>
                    </>
                  )}
                  {selected.status === "checked_in" && (
                    <Button
                      disabled={busy}
                      onClick={() => void onUpdateStatus(selected, "in_progress")}
                    >
                      Start Service
                    </Button>
                  )}
                  {selected.status === "in_progress" && (
                    <Button
                      disabled={busy}
                      onClick={() => void onUpdateStatus(selected, "completed")}
                    >
                      Complete
                    </Button>
                  )}
                  {(selected.status === "confirmed" || selected.status === "checked_in") && (
                    <Button variant="danger" disabled={busy} onClick={() => onCancel(selected)}>
                      Cancel
                    </Button>
                  )}
                  {onRemove && deletableStatuses.includes(selected.status) && (
                    <Button
                      variant="ghost"
                      icon="trash"
                      disabled={busy}
                      onClick={() => onRemove(selected)}
                    >
                      Remove booking
                    </Button>
                  )}
                </div>
                {selected.status === "pending" &&
                  bookingHasStarted(selected.date, selected.time, new Date(now)) && (
                    <p className="form-hint">
                      This request&apos;s time has passed, so it can no longer be confirmed. Reject
                      it, or edit it to a new time.
                    </p>
                  )}
                {selected.status === "confirmed" && !isBookingDay(selected.date, new Date(now)) && (
                  <p className="form-hint">
                    This appointment is on {formatDate(selected.date)}. Checking in on another day
                    asks for confirmation.
                  </p>
                )}
                {selected.status === "confirmed" &&
                  !mayMarkNoShow(selected.date, selected.time, new Date(now)) && (
                    <p className="form-hint">
                      No Show becomes available at {formatTime(noShowFrom(selected))},{" "}
                      {BOOKING_GRACE_MINUTES} minutes after the appointment starts.
                    </p>
                  )}
                {closedStatuses.includes(selected.status) && (
                  <p className="form-hint">
                    This booking no longer holds its time slot.
                    {onRemove ? " Remove it to clear it from the list." : ""}
                  </p>
                )}
              </DrawerSection>
            )}
            {events.length > 0 && (
              <DrawerSection eyebrow="Event log" title="History">
                <ol className="booking-events">
                  {events.map((event) => (
                    <li key={event.id}>
                      <strong>{eventLabel[event.type] ?? event.type}</strong>
                      <span>
                        {new Date(event.createdAt).toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {event.actorName ? ` · ${event.actorName}` : ""}
                      </span>
                      {event.detail && <small>{event.detail}</small>}
                    </li>
                  ))}
                </ol>
              </DrawerSection>
            )}
          </>
        ))}
    </DetailDrawer>
  );
}
