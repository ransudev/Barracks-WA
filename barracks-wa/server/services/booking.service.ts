import { resolveCustomerBranch, lockOperationalActor, requireBranchAccess, type BranchActor } from "@/server/auth/branch-access";
import type { Pool, PoolClient } from "pg";
import { findServiceById } from "@/server/services/service.service";
import { findAvailableBarbers, isBookingSlotAvailable } from "@/server/services/booking-availability.service";
import { BOOKING_GRACE_MINUTES, BOOKING_WINDOW_DAYS, isWithinBookingWindow, mayMarkNoShow } from "@/app/constants/booking";
import { isActiveBarberConflict, QueueServiceError, syncAppointmentQueue } from "@/server/services/queue.service";
import { BarberOperationalAvailabilityError, getBarberOperationalAvailability, requireBarberOperationalAvailability } from "@/server/services/barber-operational-availability.service";
import type {
  BookingEditInput,
  BookingCreateInput,
  BookingUpdateInput,
} from "@/server/schemas/sprint.schema";

type BookingRow = {
  branch_id: number;
  branch_name: string;
  id: number;
  booking_date: string | Date;
  booking_time: string | Date;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  barber_id: number;
  barber_name: string;
  service_id: string;
  service_name: string;
  service_price: number | string;
  service_duration_minutes: number | null;
  end_time: string | Date | null;
  notes: string | null;
  status: "pending" | "confirmed" | "rejected" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show";
  created_at: string | Date;
  updated_at: string | Date;
};

export type BookingRecord = {
  branchId: number;
  branchName: string;
  id: number;
  date: string;
  time: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  barberId: number;
  barberName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  durationMinutes: number | null;
  endTime: string | null;
  notes: string | null;
  status: BookingRow["status"];
  createdAt: string;
  updatedAt: string;
};

export class BookingServiceError extends Error {
  constructor(
    public readonly kind: "not_found" | "unavailable" | "conflict" | "past" | "too_far" | "not_updatable" | "not_deletable" | "forbidden",
    message: string,
    public reason?: import("./barber-operational-availability.service").OperationalReason,
    public interval?: import("./barber-operational-availability.service").OperationalInterval,
  ) {
    super(message);
    this.name = "BookingServiceError";
  }
}

const bookingSelect = `
  SELECT
    b.branch_id,
    branch.name AS branch_name,
    b.id,
    b.booking_date,
    b.booking_time,
    c.id AS customer_id,
    CONCAT(cu.first_name, ' ', cu.last_name) AS customer_name,
    cu.email AS customer_email,
    br.id AS barber_id,
    CONCAT(br.first_name, ' ', br.last_name) AS barber_name,
    b.service_id,
    b.service_name,
    b.service_price,
    b.service_duration_minutes,
    b.end_time,
    b.notes,
    b.status,
    b.created_at,
    b.updated_at
  FROM bookings b
  INNER JOIN branches branch ON branch.id = b.branch_id
  INNER JOIN customers c ON c.id = b.customer_id
  INNER JOIN users cu ON cu.id = c.user_id AND cu.deleted_at IS NULL
  INNER JOIN barbers br ON br.id = b.barber_id
`;

function toDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function toTimeOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(11, 16) : String(value).slice(0, 5);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toBooking(row: BookingRow): BookingRecord {
  return {
    branchId: Number(row.branch_id),
    branchName: row.branch_name,
    id: Number(row.id),
    date: toDateOnly(row.booking_date),
    time: toTimeOnly(row.booking_time),
    customerId: Number(row.customer_id),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    barberId: Number(row.barber_id),
    barberName: row.barber_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    price: Number(row.service_price),
    durationMinutes: row.service_duration_minutes,
    endTime: row.end_time === null ? null : toTimeOnly(row.end_time),
    notes: row.notes,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listBookings(
  db: Pool,
  customerId?: number,
  branchId?: number,
): Promise<BookingRecord[]> {
  const result = await db.query<BookingRow>(
    `${bookingSelect}
      WHERE ($1::integer IS NULL OR b.customer_id=$1) AND ($2::integer IS NULL OR b.branch_id=$2)
      ORDER BY b.booking_date ASC, b.booking_time ASC, b.id ASC`,
    [customerId ?? null, branchId ?? null],
  );
  return result.rows.map(toBooking);
}

export async function createBooking(
  db: Pool,
  input: BookingCreateInput & { customerId: number; branchId?: number; status?: "pending" | "confirmed" },
): Promise<BookingRecord> {
  const branchId = await resolveCustomerBranch(db, input.branchId === undefined ? null : String(input.branchId));
  input = { ...input, branchId };
  const slot = new Date(`${input.date}T${input.time}:00+08:00`);
  if (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now()) {
    throw new BookingServiceError("past", "Choose a future booking time");
  }
  if (!isWithinBookingWindow(input.date)) {
    throw new BookingServiceError("too_far", `Appointments can be booked up to ${BOOKING_WINDOW_DAYS} days ahead`);
  }

  const service = await findServiceById(db, input.serviceId);
  if (!service?.active || !service.durationMinutes) {
    throw new BookingServiceError("not_found", "That service is not available");
  }

  const customer = await db.query<{ id: number }>(
    `
      SELECT c.id
      FROM customers c
      INNER JOIN users u ON u.id = c.user_id
      INNER JOIN roles r ON r.id = u.role_id AND r.name = 'customer' AND u.deleted_at IS NULL
      WHERE c.id = $1
      LIMIT 1
    `,
    [input.customerId],
  );
  if (!customer.rows[0]) {
    throw new BookingServiceError("not_found", "Customer not found");
  }

  const candidates = await bookingCandidates(db, input);
  for (const barberId of candidates) {
    // Recheck immediately before writing. The exclusion constraints still decide races.
    if (!await isBookingSlotAvailable(db, { ...input, barberId })) continue;
    try {
      const inserted = await db.query<{ id: number }>(
      `
        INSERT INTO bookings
          (customer_id, barber_id, service_id, service_name, service_price, service_duration_minutes, booking_date, booking_time, end_time, notes, branch_id, status)
        SELECT $1, $2, $3, $4, $5, $6::integer, $7, $8,
          ($8::time + $6::integer * INTERVAL '1 minute')::time, $9, selected_branch.id, $11
        FROM customers c
        INNER JOIN users u ON u.id = c.user_id
        INNER JOIN branches selected_branch ON selected_branch.id=$10 AND selected_branch.status='active'
        WHERE c.id = $1 AND u.deleted_at IS NULL
        FOR SHARE OF c, u, selected_branch
        RETURNING id
      `,
      [
        input.customerId,
        barberId,
        service.id,
        service.name,
        service.price,
        service.durationMinutes,
        input.date,
        input.time,
        input.notes?.trim() || null,
        input.branchId ?? null,
        input.status ?? "confirmed",
      ],
    );
      if (!inserted.rows[0]) {
        await resolveCustomerBranch(db, String(branchId));
        throw new BookingServiceError("not_found", "Customer not found");
      }
      return (await findBookingById(db, inserted.rows[0].id)) as BookingRecord;
    } catch (error) {
      if (isOverlapViolation(error, "bookings_active_customer_overlap")) {
        throw new BookingServiceError("conflict", "You already have an appointment that overlaps this time");
      }
      if (isOverlapViolation(error, "bookings_active_barber_overlap") || isUniqueViolation(error)) {
        if (!input.barberId) continue;
        throw new BookingServiceError("conflict", "That barber was just booked. Choose another time or barber");
      }
      throw error;
    }
  }
  throw new BookingServiceError("conflict", input.barberId
    ? "That time is no longer open with this barber. Please choose another time"
    : "No barber is available at that time. Please choose another slot");
}

async function bookingCandidates(db: Pool, input: { serviceId: string; barberId?: number | null; date: string; time: string; branchId?: number }, excludeBookingId?: number): Promise<number[]> {
  if (!input.barberId) return findAvailableBarbers(db, input, { excludeBookingId });
  const barber = await db.query<{ id: number; status: string }>("SELECT id, status FROM barbers WHERE id=$1 AND ($2::integer IS NULL OR branch_id=$2)", [input.barberId, input.branchId ?? null]);
  if (!barber.rows[0]) throw new BookingServiceError("not_found", "Barber not found");
  if (barber.rows[0].status === "unavailable") throw new BookingServiceError("unavailable", "That barber is currently unavailable");
  return [input.barberId];
}

export async function findBookingById(
  db: Pool | PoolClient,
  id: number,
): Promise<BookingRecord | null> {
  const result = await db.query<BookingRow>(
    `${bookingSelect} WHERE b.id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ? toBooking(result.rows[0]) : null;
}

export async function updateBooking(
  db: Pool,
  id: number,
  input: BookingUpdateInput,
  scope?: { customerId?: number; actor?: BranchActor },
): Promise<BookingRecord | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const authorizedActor = await lockOperationalActor(client, scope?.actor);
    await client.query("SELECT id FROM bookings WHERE id=$1 FOR UPDATE", [id]);
    const existing = await findBookingById(client, id);
    if (!existing) { await client.query("ROLLBACK"); return null; }
    if (authorizedActor) await requireBranchAccess(client, authorizedActor, existing.branchId);
    if (scope?.customerId && existing.customerId !== scope.customerId) {
      throw new BookingServiceError("forbidden", "You can only manage your own bookings");
    }
    if (scope?.customerId && (input.status !== "cancelled" || !["pending", "confirmed"].includes(existing.status))) {
      throw new BookingServiceError("not_updatable", `Cannot mark a ${existing.status} booking ${input.status}`);
    }
    const expected: Record<BookingUpdateInput["status"], BookingRow["status"]> = {
      confirmed: "pending", rejected: "pending",
      checked_in: "confirmed", in_progress: "checked_in", completed: "in_progress",
      cancelled: ["pending", "checked_in"].includes(existing.status) ? existing.status : "confirmed", no_show: "confirmed",
    };
    if (existing.status !== expected[input.status]) {
      throw new BookingServiceError("not_updatable", `Cannot mark a ${existing.status} booking ${input.status}`);
    }
    if (input.status === "no_show" && !mayMarkNoShow(existing.date, existing.time)) {
      throw new BookingServiceError("not_updatable", `No-show is available ${BOOKING_GRACE_MINUTES} minutes after the appointment starts`);
    }
    let serviceStartedAt: string | undefined;
    if (input.status === "in_progress") {
      // Lock the linked queue row, then the barber, before checking availability.
      // The unique index is the final guard if another writer bypasses this path.
      const entry = await client.query("SELECT id FROM queue_entries WHERE booking_id=$1 FOR UPDATE", [id]);
      if (!entry.rowCount) throw new BookingServiceError("conflict", "Appointment queue entry is missing or out of sync");
      await client.query("SELECT id FROM barbers WHERE id=$1 FOR UPDATE", [existing.barberId]);
      const eligibility = await getBarberOperationalAvailability(client, existing.barberId, {
        branchId: existing.branchId, durationMinutes: existing.durationMinutes, excludeBookingId: existing.id,
      });
      requireBarberOperationalAvailability(eligibility);
      serviceStartedAt = eligibility.interval?.startsAt;
    }
    const customerScope = scope?.customerId ? " AND customer_id = $4" : "";
    const values = scope?.customerId ? [input.status, id, expected[input.status], scope.customerId] : [input.status, id, expected[input.status]];
    const result = await client.query<{ id: number }>(
      `UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3${customerScope}
       ${input.status === "no_show" ? `AND NOW() >= ((booking_date + booking_time) AT TIME ZONE 'Asia/Manila') + INTERVAL '${BOOKING_GRACE_MINUTES} minutes'` : ""}
       RETURNING id`, values,
    );
    if (!result.rows[0]) throw new BookingServiceError("not_updatable", "Booking changed while you were updating it. Reload and try again");
    if (["checked_in", "in_progress", "completed"].includes(input.status) || (input.status === "cancelled" && existing.status === "checked_in")) {
      await syncAppointmentQueue(client, id, input.status as "checked_in" | "in_progress" | "completed" | "cancelled", serviceStartedAt);
    }
    const booking = await findBookingById(client, id);
    await client.query("COMMIT");
    return booking;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof QueueServiceError || error instanceof BarberOperationalAvailabilityError)
      throw new BookingServiceError("conflict", error.message, error.reason, error.interval);
    if (isActiveBarberConflict(error)) throw new BookingServiceError("conflict", "Barber is currently serving another customer.");
    throw error;
  } finally { client.release(); }
}

export async function updateBookingDetails(
  db: Pool,
  id: number,
  input: BookingEditInput & { branchId?: number },
  scope?: { customerId?: number },
): Promise<BookingRecord | null> {
  const existingBooking = await findBookingById(db, id);
  if (!existingBooking) return null;
  input = { ...input, branchId: existingBooking.branchId };
  if (scope?.customerId) {
    const branch = await db.query<{ status: string }>("SELECT status FROM branches WHERE id=$1", [existingBooking.branchId]);
    if (!branch.rows[0] || branch.rows[0].status !== "active") {
      throw new BookingServiceError("not_updatable", "Appointments at inactive branches cannot be rescheduled");
    }
  }
  const slot = new Date(`${input.date}T${input.time}:00+08:00`);
  if (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now()) {
    throw new BookingServiceError("past", "Choose a future booking time");
  }
  if (!isWithinBookingWindow(input.date)) {
    throw new BookingServiceError("too_far", `Appointments can be booked up to ${BOOKING_WINDOW_DAYS} days ahead`);
  }

  const service = await findServiceById(db, input.serviceId);
  if (!service?.active || !service.durationMinutes) {
    throw new BookingServiceError("not_found", "That service is not available");
  }

  const customer = await db.query<{ id: number }>(
    `
      SELECT c.id
      FROM customers c
      INNER JOIN users u ON u.id = c.user_id
      INNER JOIN roles r ON r.id = u.role_id AND r.name = 'customer' AND u.deleted_at IS NULL
      WHERE c.id = $1
      LIMIT 1
    `,
    [input.customerId],
  );
  if (!customer.rows[0]) {
    throw new BookingServiceError("not_found", "Customer not found");
  }

  const candidates = await bookingCandidates(db, input, id);
  for (const barberId of candidates) {
    if (!await isBookingSlotAvailable(db, { ...input, barberId }, { excludeBookingId: id })) continue;
    try {
    const customerScope = scope?.customerId ? " AND customer_id = $11" : "";
    const values = scope?.customerId
      ? [input.customerId, barberId, service.id, service.name, service.price, service.durationMinutes, input.date, input.time, input.notes?.trim() || null, id, scope.customerId]
      : [input.customerId, barberId, service.id, service.name, service.price, service.durationMinutes, input.date, input.time, input.notes?.trim() || null, id];
    const updated = await db.query<{ id: number }>(
      `
        UPDATE bookings
        SET customer_id = $1, barber_id = $2, service_id = $3, service_name = $4,
            service_price = $5, service_duration_minutes = $6, booking_date = $7, booking_time = $8,
            end_time = ($8::time + $6::integer * INTERVAL '1 minute')::time, notes = $9, updated_at = NOW()${scope?.customerId ? ", status = 'pending'" : ""}
        WHERE id = $10 AND status IN ('pending', 'confirmed')${customerScope}
          AND EXISTS (
            SELECT 1 FROM customers c
            INNER JOIN users u ON u.id = c.user_id
            WHERE c.id = $1 AND u.deleted_at IS NULL
            FOR SHARE OF c, u
          )
        RETURNING id
      `,
      values,
    );

    if (!updated.rows[0]) {
      const existing = await db.query<{ status: BookingRow["status"]; customer_id: number }>(
        "SELECT status, customer_id FROM bookings WHERE id = $1 LIMIT 1",
        [id],
      );
      if (scope?.customerId && existing.rows[0] && Number(existing.rows[0].customer_id) !== scope.customerId) {
        throw new BookingServiceError("forbidden", "You can only manage your own bookings");
      }
      if (!["pending", "confirmed"].includes(existing.rows[0]?.status ?? "")) {
        if (existing.rows[0]) {
          throw new BookingServiceError("not_updatable", "Only pending or confirmed bookings can be updated");
        }
        return null;
      }
    }

    return updated.rows[0] ? findBookingById(db, id) : null;
    } catch (error) {
      if (isOverlapViolation(error, "bookings_active_customer_overlap")) throw new BookingServiceError("conflict", "Customer already has an appointment that overlaps this time");
      if (isOverlapViolation(error, "bookings_active_barber_overlap") || isUniqueViolation(error)) {
        if (!input.barberId) continue;
        throw new BookingServiceError("conflict", "That barber was just booked. Choose another time or barber");
      }
      throw error;
    }
  }
  throw new BookingServiceError("conflict", input.barberId
    ? "That time is no longer open with this barber. Please choose another time"
    : "No barber is available at that time. Please choose another slot");
}

/**
 * Bookings that have not started, or that closed without service (cancelled,
 * rejected, no-show), may be removed. Started and completed visits feed
 * payments and payroll, so they remain as historical records.
 */
export const deletableBookingStatuses = ["pending", "confirmed", "rejected", "cancelled", "no_show"] as const;

export async function deleteBooking(db: Pool, id: number): Promise<boolean> {
  const deleted = await db.query<{ id: number }>(
    "DELETE FROM bookings WHERE id=$1 AND status = ANY($2::text[]) RETURNING id",
    [id, [...deletableBookingStatuses]],
  );
  if (deleted.rows[0]) return true;

  const existing = await db.query<{ status: BookingRow["status"] }>(
    "SELECT status FROM bookings WHERE id=$1 LIMIT 1",
    [id],
  );
  if (!existing.rows[0]) return false;
  throw new BookingServiceError("not_deletable", "Bookings that were started or completed stay on record and cannot be removed");
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

function isOverlapViolation(error: unknown, constraint: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && "constraint" in error &&
    (error as { code?: string; constraint?: string }).code === "23P01" &&
    (error as { constraint?: string }).constraint === constraint);
}
