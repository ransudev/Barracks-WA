"use client";

import { Avatar, Badge, Button } from "@/app/components/ui";
import { DetailDrawer, DrawerSection } from "@/app/components/operations/OperationalPrimitives";
import type { ApiBarberAvailability, ApiQueueEntry } from "@/app/lib/api";
import { barberAvailabilityLabel, isBarberAvailable } from "@/app/utils/barber-availability";
import { createInitials } from "@/app/utils/format";
import { scheduledTime, statusLabel, tone, visitLabel } from "./model";

export function QueueEntryDrawer({
  selected,
  barbers,
  busy,
  onClose,
  onChange: change,
  onRemove: setPendingRemove,
}: {
  selected: ApiQueueEntry | null;
  barbers: ApiBarberAvailability[];
  busy: boolean;
  onClose: () => void;
  onChange: (
    entry: ApiQueueEntry,
    payload: { barberId: number | null } | { status: ApiQueueEntry["status"] },
  ) => Promise<void>;
  onRemove: (entry: ApiQueueEntry) => void;
}) {
  const availableBarbers = barbers.filter(isBarberAvailable);
  const selectedBarber = barbers.find((barber) => barber.id === selected?.barberId);
  const selectedBarberAvailable = Boolean(selectedBarber && isBarberAvailable(selectedBarber));
  return (
    <DetailDrawer
      open={Boolean(selected)}
      title={selected?.customerName ?? "Queue entry"}
      subtitle={selected ? `${selected.serviceName} · Queue #${selected.id}` : undefined}
      eyebrow="Live queue"
      onClose={onClose}
    >
      {selected && (
        <>
          <DrawerSection>
            <div className="operational-drawer__identity">
              <Avatar initials={createInitials(selected.customerName)} tone="slate" size="lg" />
              <div>
                <strong>{selected.serviceName}</strong>
                <span>
                  {selected.bookingId !== null ? `Booking #${selected.bookingId}` : "Walk-in"}
                </span>
                <span className="queue-visit-type">
                  <Badge tone={selected.visitType === "appointment" ? "info" : "neutral"}>
                    {visitLabel(selected)}
                  </Badge>
                  {scheduledTime(selected) && <span>• {scheduledTime(selected)}</span>}
                </span>
              </div>
              <Badge tone={tone(selected.status)}>{statusLabel(selected.status)}</Badge>
            </div>
          </DrawerSection>
          <DrawerSection eyebrow="Assignment" title="Floor handoff">
            <div className="operational-drawer__rows">
              <div className="operational-drawer__row">
                <span>Assigned barber</span>
                {selected.bookingId === null && ["waiting", "ready"].includes(selected.status) ? (
                  <select
                    className="table-select"
                    value={selected.barberId ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      void change(selected, {
                        barberId: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {selectedBarber && !selectedBarberAvailable && (
                      <option value={selectedBarber.id} disabled>
                        {selectedBarber.firstName} {selectedBarber.lastName} ·{" "}
                        {barberAvailabilityLabel(selectedBarber)}
                      </option>
                    )}
                    {availableBarbers.map((barber) => (
                      <option key={barber.id} value={barber.id}>
                        {barber.firstName} {barber.lastName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{selected.barberName ?? "Unassigned"}</strong>
                )}
              </div>
              {selected.visitType === "appointment" && (
                <>
                  <div className="operational-drawer__row">
                    <span>Scheduled</span>
                    <strong>
                      {selected.scheduledDate} {scheduledTime(selected)}
                    </strong>
                  </div>
                  <div className="operational-drawer__row">
                    <span>Booking status</span>
                    <strong>{selected.bookingStatus?.replaceAll("_", " ") ?? "—"}</strong>
                  </div>
                </>
              )}
            </div>
          </DrawerSection>
          {selected.visitType === "appointment" && (
            <DrawerSection>
              <p>Manage appointment service from Bookings.</p>
            </DrawerSection>
          )}
          {selected.visitType === "walk_in" &&
            !["completed", "removed"].includes(selected.status) && (
              <DrawerSection eyebrow="Queue actions" title="Move customer forward">
                <div className="operational-drawer__actions">
                  {selected.status === "ready" && (
                    <>
                      <Button
                        disabled={busy || !selectedBarberAvailable}
                        onClick={() => void change(selected, { status: "in_progress" })}
                      >
                        Start Service
                      </Button>
                      {!selectedBarberAvailable && (
                        <p role="status">
                          {selectedBarber
                            ? barberAvailabilityLabel(selectedBarber)
                            : "Refresh barber availability before starting."}{" "}
                          Service timing is checked again when you start.
                        </p>
                      )}
                    </>
                  )}
                  {selected.status === "in_progress" && (
                    <Button
                      disabled={busy}
                      onClick={() => void change(selected, { status: "completed" })}
                    >
                      Complete
                    </Button>
                  )}
                  {selected.bookingId === null &&
                    ["waiting", "ready"].includes(selected.status) && (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => setPendingRemove(selected)}
                      >
                        Remove
                      </Button>
                    )}
                </div>
              </DrawerSection>
            )}
        </>
      )}
    </DetailDrawer>
  );
}
