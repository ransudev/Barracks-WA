"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Panel } from "@/app/components/ui";
import { ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import { lateLabel, manilaToday, minutesLate } from "@/app/constants/booking";
import {
  apiErrorMessage,
  apiRequest,
  errorMessage,
  readApiBody,
  type ApiBooking,
} from "@/app/lib/api";
import { formatTimeRange } from "@/app/utils/format";

// Confirmed appointments for today that have not arrived yet. An accepted
// booking enters the queue when the customer is checked in, so the step lives
// here on the Queue tab as well as on the Bookings tab.
export function ExpectedTodayPanel({
  branchId,
  onToast,
  onCheckedIn,
}: {
  branchId: number;
  onToast: (message: string) => void;
  onCheckedIn: () => void;
}) {
  const [expected, setExpected] = useState<ApiBooking[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await apiRequest(`/api/bookings?branchId=${branchId}`, {
        cache: "no-store",
      });
      const body = await readApiBody<{ success: boolean; bookings?: ApiBooking[] }>(response);
      if (!response.ok || !body?.success) return;
      const today = manilaToday();
      setExpected(
        (body.bookings ?? [])
          .filter((booking) => booking.date === today && booking.status === "confirmed")
          .sort((a, b) => a.time.localeCompare(b.time)),
      );
    } catch {
      /* The queue itself still loads; this panel retries on the next refresh. */
    }
  }, [branchId]);

  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function checkIn(booking: ApiBooking) {
    setBusyId(booking.id);
    try {
      const response = await apiRequest(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "checked_in" }),
      });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(apiErrorMessage(body, "Unable to check in"));
      setExpected((current) => current.filter((item) => item.id !== booking.id));
      onToast(`${booking.customerName} checked in and added to the queue`);
      onCheckedIn();
    } catch (error) {
      onToast(errorMessage(error, "Unable to check in"));
    } finally {
      setBusyId(null);
    }
  }

  if (!expected.length) return null;
  return (
    <Panel className="operational-panel">
      <div className="inventory-catalog-head">
        <div>
          <span className="inventory-kicker">Confirmed appointments</span>
          <h2>Expected today</h2>
          <p>Check a customer in when they arrive to move them into the queue.</p>
        </div>
      </div>
      <ResponsiveTable headers={["Time", "Customer", "Service", "Barber", "Status", ""]}>
        {expected.map((booking) => {
          const late = minutesLate(booking.date, booking.time, new Date(now));
          return (
            <tr key={booking.id}>
              <td>{formatTimeRange(booking.time, booking.endTime)}</td>
              <td>{booking.customerName}</td>
              <td>{booking.serviceName}</td>
              <td>{booking.barberName}</td>
              <td>
                {late > 0 ? (
                  <Badge tone="danger">{lateLabel(late)}</Badge>
                ) : (
                  <Badge tone="info">Confirmed</Badge>
                )}
              </td>
              <td>
                <Button
                  size="sm"
                  icon="check"
                  disabled={busyId !== null}
                  onClick={() => void checkIn(booking)}
                >
                  {busyId === booking.id ? "Checking in…" : "Check in"}
                </Button>
              </td>
            </tr>
          );
        })}
      </ResponsiveTable>
    </Panel>
  );
}
