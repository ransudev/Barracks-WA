import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { lockOperationalActor, requireBranchAccess, type BranchActor } from "@/server/auth/branch-access";
import { BarberOperationalAvailabilityError, getBarberOperationalAvailability, requireBarberOperationalAvailability } from "@/server/services/barber-operational-availability.service";
import { initialQueueStatus, QueueLifecycleError, transitionQueue, type QueueState, type QueueStatus } from "@/server/services/queue-lifecycle";

type Db = Pool | PoolClient;
type WalkInInput = {
  branchId?: number;
  serviceId: string;
  barberId?: number | null;
  idempotencyKey?: string;
} & (
  | { customerId: number; customer?: never }
  | { customer: { firstName: string; lastName: string; phone: string }; customerId?: never }
);
export type { QueueStatus } from "@/server/services/queue-lifecycle";
type QueueRow = {
  branch_id: number;
  id: number; booking_id: number | null; customer_id: number; customer_name: string;
  service_id: string; service_name: string; service_duration_minutes_snapshot: number | null; barber_id: number | null; barber_name: string | null;
  scheduled_date: string | null; scheduled_time: string | null; booking_status: string | null;
  status: QueueStatus; joined_at: Date | string; started_at: Date | string | null;
  completed_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
};
type LockedQueueRow = { id: number; booking_id: number | null; status: QueueStatus; barber_id: number | null; started_at: Date | null; completed_at: Date | null };
const queueState = (row: LockedQueueRow): QueueState => ({ status: row.status, barberId: row.barber_id, startedAt: row.started_at, completedAt: row.completed_at });
async function lockQueueEntry(client: PoolClient, id: number): Promise<LockedQueueRow> {
  const result = await client.query<LockedQueueRow>("SELECT id,booking_id,status,barber_id,started_at,completed_at FROM queue_entries WHERE id=$1 FOR UPDATE", [id]);
  if (!result.rows[0]) throw new QueueServiceError("not_found", "Queue entry not found.");
  return result.rows[0];
}
export type QueueRecord = {
  branchId: number;
  id: number; bookingId: number | null; customerId: number; customerName: string;
  serviceId: string; serviceName: string; barberId: number | null; barberName: string | null;
  visitType: "walk_in" | "appointment"; scheduledDate: string | null;
  scheduledTime: string | null; bookingStatus: string | null;
  status: QueueStatus; joinedAt: string; startedAt: string | null;
  completedAt: string | null; createdAt: string; updatedAt: string;
};
export class QueueServiceError extends Error {
  constructor(public readonly kind: "invalid" | "not_found" | "conflict", message: string,
    public reason?: import("./barber-operational-availability.service").OperationalReason,
    public interval?: import("./barber-operational-availability.service").OperationalInterval) { super(message); }
}
async function withQueueTransaction<T>(db: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof BarberOperationalAvailabilityError) throw new QueueServiceError("conflict", error.message, error.reason, error.interval);
    if (error instanceof QueueLifecycleError) throw new QueueServiceError("conflict", error.message);
    if (isActiveBarberConflict(error)) throw new QueueServiceError("conflict", "Barber is currently serving another customer.");
    throw error;
  } finally { client.release(); }
}
export function isActiveBarberConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && "constraint" in error &&
    (error as { code?: string }).code === "23505" &&
    (error as { constraint?: string }).constraint === "queue_entries_one_active_service_per_barber");
}
async function requireBarber(client: PoolClient, barberId: number): Promise<void> {
  // Every queue start takes this same row lock before checking active work.
  const locked = await client.query("SELECT id FROM barbers WHERE id=$1 FOR UPDATE", [barberId]);
  if (!locked.rowCount) throw new QueueServiceError("not_found", "Barber not found.");
  requireBarberOperationalAvailability(await getBarberOperationalAvailability(client, barberId));
}
const queueSelect = `SELECT q.*, CONCAT(COALESCE(u.first_name,c.first_name),' ',COALESCE(u.last_name,c.last_name)) AS customer_name,
  q.service_name_snapshot AS service_name, CASE WHEN br.id IS NULL THEN NULL ELSE CONCAT(br.first_name,' ',br.last_name) END AS barber_name,
  b.booking_date::text AS scheduled_date, b.booking_time::text AS scheduled_time, b.status AS booking_status
  FROM queue_entries q JOIN customers c ON c.id=q.customer_id LEFT JOIN users u ON u.id=c.user_id
  JOIN services s ON s.id=q.service_id LEFT JOIN barbers br ON br.id=q.barber_id
  LEFT JOIN bookings b ON b.id=q.booking_id`;
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
function toQueue(row: QueueRow): QueueRecord {
  return { branchId: Number(row.branch_id), id: Number(row.id), bookingId: row.booking_id === null ? null : Number(row.booking_id),
    customerId: Number(row.customer_id), customerName: row.customer_name, serviceId: row.service_id,
    serviceName: row.service_name, barberId: row.barber_id === null ? null : Number(row.barber_id),
    barberName: row.barber_name, visitType: row.booking_id === null ? "walk_in" : "appointment",
    scheduledDate: row.scheduled_date, scheduledTime: row.scheduled_time, bookingStatus: row.booking_status,
    status: row.status, joinedAt: iso(row.joined_at)!, startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! };
}
export type QueueView = "active" | "completed-today";
export async function listQueue(db: Db, view: QueueView = "active", branchId?: number): Promise<QueueRecord[]> {
  // Convert Manila-local midnight to timestamptz for session-independent
  // instant comparisons; UTC midnight is not the shop's day boundary.
  const where = view === "active"
    ? `q.status IN ('waiting','ready','in_progress') AND
       (q.booking_id IS NULL OR (q.status='ready' AND b.status='checked_in')
        OR (q.status='in_progress' AND b.status='in_progress'))`
    : `q.status='completed' AND q.completed_at >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date::timestamp AT TIME ZONE 'Asia/Manila')
       AND q.completed_at < (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`;
  const result = await db.query<QueueRow>(`${queueSelect} WHERE (${where}) AND ($1::integer IS NULL OR q.branch_id=$1) ORDER BY q.joined_at, q.id`, [branchId ?? null]);
  return result.rows.map(toQueue);
}
export async function findQueueEntry(db: Db, id: number): Promise<QueueRecord | null> {
  const result = await db.query<QueueRow>(`${queueSelect} WHERE q.id=$1`, [id]);
  return result.rows[0] ? toQueue(result.rows[0]) : null;
}
// Preserve ready-entry priority, then scan unassigned walk-ins in FIFO order.
// A walk-in is only offered when its full service fits the current availability.
async function selectNextCustomer(db: Db, barberId: number, branchId?: number): Promise<QueueRecord | null> {
  const result = await db.query<QueueRow>(
    `${queueSelect} WHERE q.branch_id=COALESCE($2::integer,(SELECT branch_id FROM barbers WHERE id=$1)) AND q.started_at IS NULL AND q.completed_at IS NULL AND (
       (q.status='ready' AND q.barber_id=$1 AND
         (q.booking_id IS NULL OR (b.status='checked_in' AND b.barber_id=$1)))
       OR (q.status='waiting' AND q.barber_id IS NULL AND q.booking_id IS NULL)
     )
     ORDER BY CASE WHEN q.booking_id IS NOT NULL THEN 0 WHEN q.status='ready' THEN 1 ELSE 2 END, q.joined_at, q.id`,
    [barberId, branchId ?? null],
  );
  for (const row of result.rows) {
    const entry = toQueue(row);
    if (!(await getBarberOperationalAvailability(db, barberId, { durationMinutes: row.service_duration_minutes_snapshot,
      branchId: entry.branchId, excludeBookingId: entry.bookingId ?? undefined })).available) continue;
    transitionQueue(
      { status: entry.status, barberId: entry.barberId, startedAt: entry.startedAt, completedAt: entry.completedAt },
      entry.status === "ready" ? { status: "in_progress" } : { barberId },
    );
    return entry;
  }
  return null;
}
export async function getNextCustomer(db: Pool, barberId: number, branchId?: number): Promise<QueueRecord | null> {
  try {
    requireBarberOperationalAvailability(await getBarberOperationalAvailability(db, barberId));
    return await selectNextCustomer(db, barberId, branchId);
  } catch (error) {
    if (error instanceof BarberOperationalAvailabilityError)
      throw new QueueServiceError(error.message === "Barber not found." ? "not_found" : "conflict", error.message, error.reason, error.interval);
    if (error instanceof QueueLifecycleError) throw new QueueServiceError("conflict", error.message);
    throw error;
  }
}
export async function confirmNextCustomerAssignment(db: Pool, barberId: number, entryId: number, branchId?: number, actor?: BranchActor): Promise<QueueRecord> {
  return withQueueTransaction(db, async (client) => {
    const authorizedActor = await lockOperationalActor(client, actor);
    const current = await lockQueueEntry(client, entryId);
    const visit = (await findQueueEntry(client, entryId))!;
    if (authorizedActor) await requireBranchAccess(client, authorizedActor, visit.branchId);
    if (current.booking_id !== null || current.status !== "waiting" || current.barber_id !== null)
      throw new QueueServiceError("conflict", "This suggestion changed. Find the next customer again.");
    transitionQueue(queueState(current), { barberId });
    await requireBarber(client, barberId);
    const next = await selectNextCustomer(client, barberId, branchId);
    if (next?.id !== entryId)
      throw new QueueServiceError("conflict", "This suggestion changed. Find the next customer again.");
    const updated = await client.query(
      `UPDATE queue_entries SET barber_id=$2,status='ready',updated_at=NOW()
       WHERE id=$1 AND booking_id IS NULL AND status='waiting' AND barber_id IS NULL RETURNING id`,
      [entryId, barberId],
    );
    if (!updated.rowCount) throw new QueueServiceError("conflict", "This suggestion changed. Find the next customer again.");
    return (await findQueueEntry(client, entryId))!;
  });
}
function walkInFingerprint(input: WalkInInput): string {
  const identity = "customerId" in input
    ? { customerId: input.customerId }
    : { customer: input.customer };
  return createHash("sha256").update(JSON.stringify({
    ...identity,
    branchId: input.branchId ?? null,
    serviceId: input.serviceId,
    barberId: input.barberId ?? null,
  })).digest("hex");
}

async function findIdempotentQueueEntry(
  db: Db,
  key: string,
  fingerprint: string,
): Promise<QueueRecord | null> {
  const result = await db.query<{ id: number; idempotency_fingerprint: string }>(
    "SELECT id,idempotency_fingerprint FROM queue_entries WHERE idempotency_key=$1",
    [key],
  );
  const existing = result.rows[0];
  if (!existing) return null;
  if (existing.idempotency_fingerprint.trim() !== fingerprint)
    throw new QueueServiceError("conflict", "This walk-in submission was already used for different details.");
  const entry = await findQueueEntry(db, existing.id);
  if (!entry) throw new Error("Unable to read the existing queue entry");
  return entry;
}

function isIdempotencyConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && "constraint" in error &&
    (error as { code?: string }).code === "23505" &&
    (error as { constraint?: string }).constraint === "queue_entries_idempotency_key_unique");
}

export async function addWalkIn(db: Pool, input: WalkInInput): Promise<QueueRecord> {
  const fingerprint = input.idempotencyKey ? walkInFingerprint(input) : null;
  try {
    return await withQueueTransaction(db, async (client) => {
      if (input.idempotencyKey && fingerprint) {
        const existing = await findIdempotentQueueEntry(client, input.idempotencyKey, fingerprint);
        if (existing) return existing;
      }

      const customerId = "customerId" in input
        ? input.customerId
        : (await client.query<{ id: number }>(
          `INSERT INTO customers(first_name,last_name,phone)
           VALUES($1,$2,$3) RETURNING id`,
          [input.customer.firstName, input.customer.lastName, input.customer.phone],
        )).rows[0].id;
      const barberId = input.barberId ?? null;
      if (barberId !== null) await requireBarber(client, barberId);

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO queue_entries(
           customer_id,service_id,barber_id,service_name_snapshot,service_price_snapshot,
           status,idempotency_key,idempotency_fingerprint,branch_id
         )
         SELECT c.id,s.id,br.id,s.name,s.current_price,$4,$5::uuid,$6::char(64),COALESCE($7::integer,(SELECT id FROM branches WHERE code='MAIN'))
         FROM customers c
         LEFT JOIN users u ON u.id=c.user_id
         LEFT JOIN roles r ON r.id=u.role_id
         CROSS JOIN services s
         LEFT JOIN barbers br ON br.id=$3 AND br.status<>'unavailable'
         WHERE c.id=$1
           AND (c.user_id IS NULL OR (u.id IS NOT NULL AND u.deleted_at IS NULL AND r.name='customer'))
           AND s.id=$2 AND s.active=true
           AND ($3::integer IS NULL OR br.id IS NOT NULL)
         RETURNING id`,
        [customerId, input.serviceId, barberId, initialQueueStatus(barberId), input.idempotencyKey ?? null, fingerprint, input.branchId ?? null],
      );
      if (!inserted.rows[0]) throw new QueueServiceError("invalid", "Choose an active customer, service, and available barber");
      return (await findQueueEntry(client, inserted.rows[0].id))!;
    });
  } catch (error) {
    if (input.idempotencyKey && fingerprint && isIdempotencyConflict(error)) {
      const existing = await findIdempotentQueueEntry(db, input.idempotencyKey, fingerprint);
      if (existing) return existing;
    }
    throw error;
  }
}
export async function assignQueueBarber(db: Pool, id: number, barberId: number | null): Promise<QueueRecord> {
  return withQueueTransaction(db, async (client) => {
    const current = await lockQueueEntry(client, id);
    const status = transitionQueue(queueState(current), { barberId });
    if (current.booking_id !== null) throw new QueueServiceError("conflict", "Manage appointment status from Bookings.");
    if (barberId !== null) await requireBarber(client, barberId);
    const result = await client.query<{ id: number }>(
      `UPDATE queue_entries q SET barber_id=$2, status=$3, updated_at=NOW()
       WHERE q.id=$1 AND q.booking_id IS NULL AND q.status=$4
         AND ($2::integer IS NULL OR EXISTS(SELECT 1 FROM barbers WHERE id=$2 AND status<>'unavailable')) RETURNING id`,
      [id, barberId, status, current.status],
    );
    if (!result.rows[0]) throw new QueueServiceError("conflict", "This queue entry cannot be assigned that barber");
    return (await findQueueEntry(client, id))!;
  });
}
export async function updateWalkInStatus(db: Pool, id: number, status: QueueStatus, actor?: BranchActor): Promise<QueueRecord> {
  return withQueueTransaction(db, async (client) => {
    const authorizedActor = await lockOperationalActor(client, actor);
    const current = await lockQueueEntry(client, id);
    const entry = (await findQueueEntry(client, id))!;
    if (authorizedActor) await requireBranchAccess(client, authorizedActor, entry.branchId);
    transitionQueue(queueState(current), { status });
    if (current.booking_id !== null) throw new QueueServiceError("conflict", "Manage appointment status from Bookings.");
    let serviceStartedAt: string | undefined;
    if (status === "in_progress") {
      await requireBarber(client, current.barber_id!);
      const visit = (await client.query<{ branch_id: number; service_duration_minutes_snapshot: number | null }>(
        "SELECT branch_id,service_duration_minutes_snapshot FROM queue_entries WHERE id=$1", [id])).rows[0];
      const eligibility = await getBarberOperationalAvailability(client, current.barber_id!, {
        branchId: Number(visit.branch_id), durationMinutes: visit.service_duration_minutes_snapshot,
      });
      requireBarberOperationalAvailability(eligibility);
      serviceStartedAt = eligibility.interval?.startsAt;
    }
    const result = await client.query<{ id: number }>(
      `UPDATE queue_entries SET status=$2::varchar,
         started_at=CASE WHEN $2::varchar='in_progress' THEN COALESCE(started_at,$4::timestamptz,clock_timestamp()) ELSE started_at END,
         completed_at=CASE WHEN $2::varchar='completed' THEN COALESCE(completed_at,GREATEST(clock_timestamp(),started_at)) ELSE completed_at END,
         updated_at=NOW()
       WHERE id=$1 AND booking_id IS NULL AND status=$3 RETURNING id`,
      [id, status, current.status, serviceStartedAt ?? null],
    );
    if (!result.rows[0]) throw new QueueServiceError("conflict", "Queue status changed or a barber must be assigned first");
    return (await findQueueEntry(client, id))!;
  });
}

export async function syncAppointmentQueue(client: PoolClient, bookingId: number, status: "checked_in" | "in_progress" | "completed" | "cancelled", serviceStartedAt?: string): Promise<void> {
  if (status === "checked_in") {
    const inserted = await client.query(
      `INSERT INTO queue_entries(booking_id,customer_id,service_id,service_name_snapshot,service_price_snapshot,barber_id,status,branch_id)
       SELECT id,customer_id,service_id,service_name,service_price,barber_id,'ready',branch_id
       FROM bookings WHERE id=$1 AND barber_id IS NOT NULL
       ON CONFLICT (booking_id) DO NOTHING RETURNING id`, [bookingId],
    );
    if (!inserted.rowCount) throw new QueueServiceError("conflict", "Appointment queue entry is missing or out of sync");
    return;
  }
  const current = await client.query<LockedQueueRow>(
    "SELECT id,booking_id,status,barber_id,started_at,completed_at FROM queue_entries WHERE booking_id=$1 FOR UPDATE", [bookingId]);
  if (!current.rows[0]) throw new QueueServiceError("conflict", "Appointment queue entry is missing or out of sync");
  const queueStatus = status === "in_progress" ? "in_progress" : status === "completed" ? "completed" : "removed";
  transitionQueue(queueState(current.rows[0]), { status: queueStatus });
  const result = await client.query(
    `UPDATE queue_entries SET status=$2::varchar,
       started_at=CASE WHEN $2::varchar='in_progress' THEN COALESCE(started_at,$4::timestamptz,clock_timestamp()) ELSE started_at END,
       completed_at=CASE WHEN $2::varchar='completed' THEN COALESCE(completed_at,GREATEST(clock_timestamp(),started_at)) ELSE completed_at END, updated_at=NOW()
     WHERE booking_id=$1 AND status=$3 RETURNING id`,
    [bookingId, queueStatus, current.rows[0].status, serviceStartedAt ?? null],
  );
  if (!result.rowCount) throw new QueueServiceError("conflict", "Appointment queue entry is missing or out of sync");
}
