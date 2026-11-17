import type { Pool, PoolClient } from "pg";
import type { ServiceInput, ServiceUpdateInput } from "@/server/schemas/service.schema";
import { ACTIVE_BOOKING, ACTIVE_QUEUE, requireServiceUnlocked } from "@/server/services/record-locks";

type ServiceRow = { id: string; name: string; description: string; current_price: string; duration_minutes: number | null; active: boolean; created_at: Date; updated_at: Date; has_history: boolean; inclusions: string[]; active_uses: number };
// activeUses: live bookings and queue visits using the service. While above zero the service is locked from editing.
export type ServiceRecord = { id: string; name: string; description: string; price: number; durationMinutes: number | null; active: boolean; createdAt: string; updatedAt: string; hasHistory: boolean; inclusions: string[]; activeUses: number };
const historyCheck = `EXISTS (SELECT 1 FROM bookings WHERE service_id = services.id)
  OR EXISTS (SELECT 1 FROM queue_entries WHERE service_id = services.id)
  OR EXISTS (SELECT 1 FROM transactions WHERE service_id = services.id)`;
const columns = `id, name, description, current_price, duration_minutes, active, created_at, updated_at, inclusions,
  ((SELECT count(*) FROM bookings WHERE service_id = services.id AND ${ACTIVE_BOOKING})
   + (SELECT count(*) FROM queue_entries WHERE service_id = services.id AND ${ACTIVE_QUEUE}))::int AS active_uses,
  (${historyCheck}) AS has_history`;
function map(row: ServiceRow): ServiceRecord {
  return { id: row.id, name: row.name, description: row.description, price: Number(row.current_price), durationMinutes: row.duration_minutes, active: row.active, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), hasHistory: row.has_history, inclusions: row.inclusions ?? [], activeUses: Number(row.active_uses ?? 0) };
}
export async function listServices(db: Pool, activeOnly = false): Promise<ServiceRecord[]> {
  const result = await db.query<ServiceRow>(`SELECT ${columns} FROM services ${activeOnly ? "WHERE active = TRUE" : ""} ORDER BY name`);
  return result.rows.map(map);
}
export async function findServiceById(db: Pool | PoolClient, id: string): Promise<ServiceRecord | null> {
  const result = await db.query<ServiceRow>(`SELECT ${columns} FROM services WHERE id = $1`, [id]);
  return result.rows[0] ? map(result.rows[0]) : null;
}
export async function createService(db: Pool, input: ServiceInput): Promise<ServiceRecord> {
  const result = await db.query<ServiceRow>(`INSERT INTO services (id, name, description, current_price, duration_minutes, active, inclusions)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`, [input.id, input.name, input.description, input.price, input.durationMinutes, input.active, input.inclusions ?? []]);
  return map(result.rows[0]);
}

export type DeleteServiceResult = "deleted" | "not_found" | "has_history";

export async function deleteService(db: Pool, id: string): Promise<DeleteServiceResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query("SELECT id FROM services WHERE id = $1 FOR UPDATE", [id]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return "not_found";
    }
    // The row lock prevents new foreign-key references while usage is checked.
    const usage = await client.query<{ has_history: boolean }>(
      `SELECT (${historyCheck}) AS has_history FROM services WHERE id = $1`, [id],
    );
    if (usage.rows[0].has_history) {
      await client.query("ROLLBACK");
      return "has_history";
    }
    await client.query("DELETE FROM services WHERE id = $1", [id]);
    await client.query("COMMIT");
    return "deleted";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23503") return "has_history";
    throw error;
  } finally {
    client.release();
  }
}
export async function updateService(db: Pool, id: string, input: ServiceUpdateInput): Promise<ServiceRecord | null> {
  const existing = await findServiceById(db, id);
  if (!existing) return null;
  // A service that live bookings or queue visits use is locked from editing.
  await requireServiceUnlocked(db, id);
  if (input.active === true && !(input.durationMinutes ?? existing.durationMinutes)) {
    throw new Error("Set a positive duration before enabling this service");
  }
  const result = await db.query<ServiceRow>(`UPDATE services SET name=$2, description=$3, current_price=$4,
    duration_minutes=$5, active=$6, inclusions=$7, updated_at=NOW() WHERE id=$1 RETURNING ${columns}`,
    [id, input.name ?? existing.name, input.description ?? existing.description, input.price ?? existing.price,
      input.durationMinutes ?? existing.durationMinutes, input.active ?? existing.active, input.inclusions ?? existing.inclusions]);
  return result.rows[0] ? map(result.rows[0]) : null;
}
