"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Avatar, Badge, Button } from "@/app/components/ui";
import { DetailDrawer, DrawerSection } from "@/app/components/operations/OperationalPrimitives";
import { BOOKING_GRACE_MINUTES, mayMarkNoShow } from "@/app/constants/booking";
import type { ApiBooking, ApiBookingStatus } from "@/app/lib/api";
import {
  createInitials,
  formatCurrency,
  formatDate,
  formatTime,
  formatTimeRange,
} from "@/app/utils/format";
import { closedStatuses, deletableStatuses, label, noShowFrom, tone } from "./model";

export function BookingDetailDrawer({
  selected,
  editing,
  form,
  busy,
  onClose,
  onUpdateStatus,
  onEdit,
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
  onCancel: (booking: ApiBooking) => void;
  onRemove: (booking: ApiBooking) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

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
                        onClick={() => void onUpdateStatus(selected, "confirmed")}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="danger"
                        icon="x"
                        disabled={busy}
                        onClick={() => void onUpdateStatus(selected, "rejected")}
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
                        onClick={() => void onUpdateStatus(selected, "checked_in")}
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
                  {deletableStatuses.includes(selected.status) && (
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
                {selected.status === "confirmed" &&
                  !mayMarkNoShow(selected.date, selected.time, new Date(now)) && (
                    <p className="form-hint">
                      No Show becomes available at {formatTime(noShowFrom(selected))},{" "}
                      {BOOKING_GRACE_MINUTES} minutes after the appointment starts.
                    </p>
                  )}
                {closedStatuses.includes(selected.status) && (
                  <p className="form-hint">
                    This booking no longer holds its time slot. Remove it to clear it from the list.
                  </p>
                )}
              </DrawerSection>
            )}
          </>
        ))}
    </DetailDrawer>
  );
}
