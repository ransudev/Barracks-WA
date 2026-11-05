"use client";

import { Avatar, Badge, Panel } from "@/app/components/ui";
import { RecordCard } from "@/app/components/operations/OperationalPrimitives";
import type { ApiBooking } from "@/app/lib/api";
import { createInitials, formatCurrency, formatDate, formatTime } from "@/app/utils/format";
import type { ReactNode } from "react";
import { cardDate } from "./model";

export function AwaitingApprovalPanel({
  awaiting,
  quickActions,
  onOpen: openDetails,
}: {
  awaiting: ApiBooking[];
  quickActions: (booking: ApiBooking) => ReactNode;
  onOpen: (booking: ApiBooking) => void;
}) {
  return (
    <Panel className="operational-panel bookings-approval">
      <div className="bookings-approval__head">
        <div>
          <h2>Awaiting approval</h2>
          <p>
            {awaiting.length} customer request{awaiting.length === 1 ? "" : "s"} to confirm or
            reject. Each request holds its time slot until you decide.
          </p>
        </div>
      </div>
      <div className="operational-card-grid">
        {awaiting.map((booking) => (
          <RecordCard
            key={booking.id}
            onOpen={() => openDetails(booking)}
            ariaLabel={`Open booking request from ${booking.customerName}`}
            actions={quickActions(booking)}
          >
            <div className="operational-card__header">
              <h3>
                {formatDate(booking.date, cardDate)} · {formatTime(booking.time)}
              </h3>
              <Badge tone="warning">Awaiting approval</Badge>
            </div>
            <div className="operational-card__identity">
              <Avatar initials={createInitials(booking.customerName)} tone="slate" size="sm" />
              <strong>{booking.customerName}</strong>
            </div>
            <p>
              {booking.serviceName} · {booking.barberName}
            </p>
            <small>
              #{booking.id} · {formatCurrency(booking.price)}
              {booking.notes ? ` · “${booking.notes}”` : ""}
            </small>
          </RecordCard>
        ))}
      </div>
    </Panel>
  );
}
