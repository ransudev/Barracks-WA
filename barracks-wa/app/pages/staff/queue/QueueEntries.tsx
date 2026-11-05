"use client";

import { Avatar, Badge } from "@/app/components/ui";
import {
  RecordCard,
  ResponsiveTable,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";
import type { ApiQueueEntry } from "@/app/lib/api";
import { createInitials } from "@/app/utils/format";
import { scheduledTime, statusLabel, tone, visitLabel, waitMinutes } from "./model";

export function QueueEntries({
  entries,
  view,
  onOpen: openEntry,
}: {
  entries: ApiQueueEntry[];
  view: OperationalViewMode;
  onOpen: (entry: ApiQueueEntry) => void;
}) {
  if (view === "cards")
    return (
      <div className="operational-card-grid">
        {entries.map((entry) => (
          <RecordCard
            key={entry.id}
            onOpen={() => openEntry(entry)}
            ariaLabel={`Open queue entry for ${entry.customerName}`}
          >
            <div className="operational-card__header">
              <div className="operational-card__identity">
                <Avatar initials={createInitials(entry.customerName)} tone="slate" size="md" />
                <div>
                  <strong>{entry.customerName}</strong>
                  <small>
                    Queue #{entry.id}
                    {entry.bookingId !== null && ` · Booking #${entry.bookingId}`}
                  </small>
                </div>
              </div>
              <Badge tone={tone(entry.status)}>{statusLabel(entry.status)}</Badge>
            </div>
            <div className="queue-visit-type">
              <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                {visitLabel(entry)}
              </Badge>
              {scheduledTime(entry) && <span>• {scheduledTime(entry)}</span>}
            </div>
            <p className="operational-card__note">
              {entry.serviceName} · {entry.barberName ?? "Awaiting barber"}
            </p>
            <div className="operational-card__facts">
              <div>
                <span>Joined</span>
                <strong>
                  {new Date(entry.joinedAt).toLocaleTimeString("en-PH", {
                    timeZone: "Asia/Manila",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </strong>
              </div>
              <div>
                <span>Wait</span>
                <strong>{entry.status === "completed" ? "—" : `${waitMinutes(entry)}m`}</strong>
              </div>
            </div>
          </RecordCard>
        ))}
      </div>
    );
  return (
    <ResponsiveTable headers={["#", "Customer", "Type", "Service", "Barber", "Status", "Wait"]}>
      {entries.map((entry) => (
        <tr
          key={entry.id}
          tabIndex={0}
          onClick={() => openEntry(entry)}
          onKeyDown={(event) => {
            if (event.key === "Enter") openEntry(entry);
          }}
        >
          <td>{entry.id}</td>
          <td>{entry.customerName}</td>
          <td>
            <span className="queue-visit-type">
              <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                {visitLabel(entry)}
              </Badge>
              {scheduledTime(entry) && <span>• {scheduledTime(entry)}</span>}
            </span>
          </td>
          <td>{entry.serviceName}</td>
          <td>{entry.barberName ?? "Unassigned"}</td>
          <td>
            <Badge tone={tone(entry.status)}>{statusLabel(entry.status)}</Badge>
          </td>
          <td>{entry.status === "completed" ? "—" : `${waitMinutes(entry)}m`}</td>
        </tr>
      ))}
    </ResponsiveTable>
  );
}
