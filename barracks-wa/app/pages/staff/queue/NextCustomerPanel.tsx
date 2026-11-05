"use client";

import { Badge, Button, Panel, SelectField } from "@/app/components/ui";
import type { ApiBarberAvailability, ApiQueueEntry } from "@/app/lib/api";
import { scheduledTime, visitLabel } from "./model";
import type { useNextCustomer } from "./useNextCustomer";

export function NextCustomerPanel({
  next: {
    nextBarberId,
    nextEntry,
    nextMessage,
    nextBusy,
    selectBarber,
    suggestNext,
    confirmNextAssignment,
  },
  availableBarbers,
  loading,
  busy,
  onRefreshAvailability,
  onOpenEntry,
}: {
  next: ReturnType<typeof useNextCustomer>;
  availableBarbers: ApiBarberAvailability[];
  loading: boolean;
  busy: boolean;
  onRefreshAvailability: () => void;
  onOpenEntry: (entry: ApiQueueEntry) => void;
}) {
  return (
    <Panel className="queue-next-panel">
      <div className="inventory-catalog-head">
        <div>
          <span className="inventory-kicker">Front desk</span>
          <h2>Next Customer</h2>
          <p>Choose an available barber, then review the suggested customer.</p>
        </div>
      </div>
      <div className="queue-next__body">
        <div className="queue-next__controls">
          <SelectField
            label="Barber"
            value={nextBarberId}
            disabled={nextBusy}
            onChange={(event) => selectBarber(event.target.value)}
          >
            <option value="">Select barber</option>
            {availableBarbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.firstName} {barber.lastName}
              </option>
            ))}
          </SelectField>
          <Button
            type="button"
            size="sm"
            disabled={
              !availableBarbers.some((barber) => String(barber.id) === nextBarberId) ||
              nextBusy ||
              loading
            }
            onClick={() => void suggestNext()}
          >
            {nextBusy ? "Checking…" : "Next Customer"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || nextBusy || loading}
            onClick={onRefreshAvailability}
          >
            Refresh availability
          </Button>
        </div>
        {nextMessage && (
          <p className="queue-next__message" role="status">
            {nextMessage}
          </p>
        )}
        {nextEntry && (
          <div
            className="queue-next__suggestion"
            role="region"
            aria-label="Suggested next customer"
          >
            <div>
              <strong>{nextEntry.customerName}</strong>
              <span>
                {nextEntry.serviceName} ·{" "}
                {nextEntry.visitType === "appointment" ? "Checked-in appointment" : "Walk-in"}
              </span>
              <span className="queue-visit-type">
                <Badge tone={nextEntry.visitType === "appointment" ? "info" : "neutral"}>
                  {visitLabel(nextEntry)}
                </Badge>
                {scheduledTime(nextEntry) && <span>• {scheduledTime(nextEntry)}</span>}
              </span>
            </div>
            <dl>
              <div>
                <dt>Joined / checked in</dt>
                <dd>
                  {new Date(nextEntry.joinedAt).toLocaleString("en-PH", {
                    timeZone: "Asia/Manila",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              <div>
                <dt>Current barber</dt>
                <dd>{nextEntry.barberName ?? "Unassigned"}</dd>
              </div>
            </dl>
            {nextEntry.status === "waiting" ? (
              <Button
                type="button"
                size="sm"
                disabled={nextBusy}
                onClick={() => void confirmNextAssignment()}
              >
                Assign barber
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onOpenEntry(nextEntry)}
              >
                Open queue entry
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
