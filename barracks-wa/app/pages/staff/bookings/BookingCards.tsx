"use client";

import { Avatar, Badge } from "@/app/components/ui";
import { RecordCard } from "@/app/components/operations/OperationalPrimitives";
import type { ApiBooking } from "@/app/lib/api";
import { createInitials, formatCurrency, formatDate, formatTime } from "@/app/utils/format";
import type { ReactNode } from "react";
import { cardDate, label, tone } from "./model";

export function BookingCards({
  bookings,
  showDate,
  quickActions,
  onOpen,
}: {
  bookings: ApiBooking[];
  showDate: boolean;
  quickActions: (booking: ApiBooking) => ReactNode;
  onOpen: (booking: ApiBooking) => void;
}) {
  return (
    <div className="operational-card-grid">
      {bookings.map((booking) => (
        <RecordCard
          key={booking.id}
          onOpen={() => onOpen(booking)}
          ariaLabel={`Open booking for ${booking.customerName}`}
          actions={quickActions(booking)}
        >
          <div className="operational-card__header">
            <h3>
              {showDate
                ? `${formatDate(booking.date, cardDate)} · ${formatTime(booking.time)}`
                : formatTime(booking.time)}
            </h3>
            <Badge tone={tone(booking.status)}>{label(booking.status)}</Badge>
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
          </small>
        </RecordCard>
      ))}
    </div>
  );
}
