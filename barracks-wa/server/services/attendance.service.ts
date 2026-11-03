import { listAccessibleBranches, requireBranchAccess, resolveOperationalBranch, type BranchActor } from "@/server/auth/branch-access";
import { BranchError } from "@/server/services/branch.service";
import type { UserRole } from "@/server/schemas/user.schema";
import type { PoolClient } from "pg";
import type { Pool } from "pg";
import type { z } from "zod";
import type { attendanceActionSchema, attendanceCorrectionSchema, attendanceHistorySchema } from "@/server/schemas/attendance.schema";

type AttendanceRow = {
  branch_id: number; id: string | number; barber_id: number; barber_name: string; attendance_date: string;
  status: "present" | "late" | "absent"; clock_in: Date | string | null; clock_out: Date | string | null;
  recorded_by: number; updated_by: number; created_at: Date | string; updated_at: Date | string;
};

export class AttendanceConflict extends Error {}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toAttendance(row: AttendanceRow) {
  return {
    branchId: Number(row.branch_id), id: Number(row.id), barberId: Number(row.barber_id), barberName: row.barber_name,
    date: row.attendance_date,
    status: row.status, clockIn: iso(row.clock_in), clockOut: iso(row.clock_out),
    recordedBy: Number(row.recorded_by), updatedBy: Number(row.updated_by),
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

// Keep the Manila calendar date as text; pg parses DATE at server-local midnight.
const select = `SELECT a.branch_id, a.id, a.barber_id, a.attendance_date::text AS attendance_date,
  a.status, a.clock_in, a.clock_out, a.recorded_by, a.updated_by, a.created_at, a.updated_at,
  b.first_name || ' ' || b.last_name AS barber_name
  FROM barber_attendance a JOIN barbers b ON b.id = a.barber_id`;

export async function listTodayAttendance(db: Pool, branchIds?: number[]) {
  const result = await db.query<AttendanceRow>(`${select}
    WHERE a.attendance_date = (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date
      AND ($1::integer[] IS NULL OR a.branch_id=ANY($1))
    ORDER BY b.first_name, b.last_name, b.id`, [branchIds ?? null]);
  return result.rows.map(toAttendance);
}

export async function listAttendanceHistory(db: Pool, filters: z.infer<typeof attendanceHistorySchema>, branchIds?: number[]) {
  const result = await db.query<AttendanceRow>(`${select}
    WHERE ($1::integer IS NULL OR a.barber_id = $1)
      AND ($2::date IS NULL OR a.attendance_date = $2)
      AND ($3::varchar IS NULL OR a.status = $3)
      AND ($4::integer[] IS NULL OR a.branch_id=ANY($4))
      AND ($5::date IS NULL OR a.attendance_date >= $5)
      AND ($6::date IS NULL OR a.attendance_date <= $6)
    ORDER BY a.attendance_date DESC, b.first_name, b.last_name, a.id DESC`, [filters.barberId ?? null, filters.date ?? null, filters.status ?? null, branchIds ?? null, filters.dateFrom ?? null, filters.dateTo ?? null]);
  return result.rows.map(toAttendance);
}

export async function actOnTodayAttendance(db: Pool, barberId: number, actorId: number, action: z.infer<typeof attendanceActionSchema>, selectedBranchId?: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await attendanceActor(client, actorId, ["administrator", "manager", "front_desk"]);
    const barber = await client.query<{ id: number; branch_id: number }>("SELECT id,branch_id FROM barbers WHERE id = $1 FOR UPDATE", [barberId]);
    if (!barber.rowCount) { await client.query("ROLLBACK"); return null; }
    const existing = await client.query<AttendanceRow>(`${select}
      WHERE a.barber_id = $1 AND a.attendance_date = (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date FOR UPDATE OF a`, [barberId]);
    const record = existing.rows[0];
    const owner = Number(record?.branch_id ?? barber.rows[0].branch_id);
    await requireBranchAccess(client, actor, owner);
    if (selectedBranchId !== undefined && selectedBranchId !== owner)
      throw new BranchError("Today's attendance belongs to a different branch", 403);
    if (action.action === "clock_out" && (!record?.clock_in || record.clock_out))
      throw new AttendanceConflict("Clock-out requires an open clock-in");
    if (action.action === "clock_out" && (await client.query(
      "SELECT id FROM queue_entries WHERE barber_id=$1 AND status='in_progress' LIMIT 1", [barberId])).rowCount)
      throw new AttendanceConflict("Complete the active service before clocking this barber out");
    if (action.action === "clock_in" && record?.clock_in)
      throw new AttendanceConflict("Barber is already clocked in");
    if (action.action === "mark" && action.status === "absent" && (record?.clock_in || record?.clock_out))
      throw new AttendanceConflict("Clocked attendance cannot be marked absent; use a management correction");
    const status = action.action === "mark" ? action.status : record?.status === "late" ? "late" : "present";
    const changed = record
      ? await client.query<{ id: number }>(`UPDATE barber_attendance SET
          status = $2, clock_in = CASE WHEN $3 = 'clock_in' THEN clock_timestamp() ELSE clock_in END,
          clock_out = CASE WHEN $3 = 'clock_out' THEN clock_timestamp() ELSE clock_out END,
          updated_by = $4, updated_at = clock_timestamp() WHERE id = $1 RETURNING id`,
          [record.id, status, action.action, actorId])
      : await client.query<{ id: number }>(`INSERT INTO barber_attendance
          (barber_id, attendance_date, status, clock_in, recorded_by, updated_by, branch_id)
          VALUES ($1, (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date, $2,
          CASE WHEN $3 = 'clock_in' THEN clock_timestamp() ELSE NULL END, $4, $4, $5) RETURNING id`,
          [barberId, status, action.action, actorId, owner]);
    const saved = await client.query<AttendanceRow>(`${select} WHERE a.id = $1`, [changed.rows[0].id]);
    await client.query("COMMIT");
    return toAttendance(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function correctAttendance(db: Pool, id: number, actorId: number, input: z.infer<typeof attendanceCorrectionSchema>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await attendanceActor(client, actorId, ["administrator", "manager"]);
    const target = (await client.query<{ barber_id: number }>("SELECT barber_id FROM barber_attendance WHERE id=$1", [id])).rows[0];
    if (!target) { await client.query("ROLLBACK"); return null; }
    // Starts/attendance actions acquire barber before attendance; use that same order.
    await client.query("SELECT id FROM barbers WHERE id=$1 FOR UPDATE", [target.barber_id]);
    const current = await client.query<AttendanceRow>(`${select} WHERE a.id = $1 FOR UPDATE OF a`, [id]);
    if (!current.rows[0]) { await client.query("ROLLBACK"); return null; }
    await requireBranchAccess(client, actor, Number(current.rows[0].branch_id));
    const before = toAttendance(current.rows[0]);
    const next = { status: input.status, clockIn: input.clockIn, clockOut: input.clockOut };
    const previous = { status: before.status, clockIn: before.clockIn, clockOut: before.clockOut };
    if (JSON.stringify(previous) === JSON.stringify(next)) throw new AttendanceConflict("Correction must change the record");
    await client.query(`UPDATE barber_attendance SET status=$2, clock_in=$3, clock_out=$4,
      updated_by=$5, updated_at=clock_timestamp() WHERE id=$1`, [id, next.status, next.clockIn, next.clockOut, actorId]);
    await client.query(`INSERT INTO barber_attendance_corrections
      (attendance_id, previous_values, new_values, reason, corrected_by)
      VALUES ($1,$2::jsonb,$3::jsonb,$4,$5)`, [id, JSON.stringify(previous), JSON.stringify(next), input.reason, actorId]);
    const saved = await client.query<AttendanceRow>(`${select} WHERE a.id=$1`, [id]);
    await client.query("COMMIT");
    return toAttendance(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function listAttendanceCorrections(db: Pool, id: number, branchIds?: number[]) {
  const result = await db.query<{
    id: string | number; previous_values: unknown; new_values: unknown; reason: string;
    corrected_by: number; corrected_by_name: string; created_at: Date | string;
  }>(`SELECT c.*, u.first_name || ' ' || u.last_name AS corrected_by_name
    FROM barber_attendance_corrections c JOIN barber_attendance a ON a.id=c.attendance_id JOIN users u ON u.id=c.corrected_by
    WHERE c.attendance_id=$1 AND ($2::integer[] IS NULL OR a.branch_id=ANY($2)) ORDER BY c.id DESC`, [id, branchIds ?? null]);
  return result.rows.map((row) => ({ id: Number(row.id), previousValues: row.previous_values,
    newValues: row.new_values, reason: row.reason, correctedBy: Number(row.corrected_by),
    correctedByName: row.corrected_by_name, createdAt: iso(row.created_at)! }));
}

// Reads may span accessible branches, while an explicit selection narrows them.
export async function attendanceBranches(db: Pool, actor: BranchActor, request: Request): Promise<number[] | undefined> {
  const raw = new URL(request.url).searchParams.get("branchId");
  if (raw !== null) return [await resolveOperationalBranch(db, actor, raw)];
  return actor.role === "administrator" ? undefined : (await listAccessibleBranches(db, actor)).map((branch) => branch.id);
}

async function attendanceActor(client: PoolClient, id: number, roles: UserRole[]): Promise<BranchActor> {
  // Membership edits lock the user too; keep authorization stable through writes.
  const row = (await client.query<{ role: UserRole }>(`SELECT r.name AS role FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified AND NOT u.is_blocked FOR SHARE OF u`, [id])).rows[0];
  if (!row || !roles.includes(row.role)) throw new BranchError("Attendance staff access is required", 403);
  return { id, role: row.role };
}
