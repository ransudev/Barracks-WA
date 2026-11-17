import type { Pool, PoolClient } from "pg";
import type { Branch, BranchAssignment, BranchStaff } from "@/app/types/branch";
import type { BranchInput, BranchUpdateInput } from "@/server/schemas/branch.schema";
import { countBranchActiveBookings } from "@/server/services/record-locks";

type Db = Pool | PoolClient;
type BranchRow = Omit<Branch, "createdAt" | "updatedAt"> & { created_at: Date; updated_at: Date };
// Access checks read only the long-standing columns; the receipt TIN is added
// for the Branches management screen and for writes.
const columns = "id, name, code, address, phone, status, created_at, updated_at";
const detailColumns = `${columns}, tin`;
const mapBranch = (row: BranchRow): Branch => ({ id: row.id, name: row.name, code: row.code, address: row.address, phone: row.phone, ...(row.tin === undefined ? {} : { tin: row.tin }), status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

export class BranchError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function listBranches(db: Db, activeOnly = false, details = false): Promise<Branch[]> {
  return (await db.query<BranchRow>(`SELECT ${details ? detailColumns : columns} FROM branches ${activeOnly ? "WHERE status='active'" : ""} ORDER BY name, id`)).rows.map(mapBranch);
}
export async function listAssignedBranches(db: Db, userId: number): Promise<Branch[]> {
  return (await db.query<BranchRow>(`SELECT ${columns} FROM branches
    WHERE id IN (SELECT branch_id FROM user_branches WHERE user_id=$1) ORDER BY name,id`, [userId])).rows.map(mapBranch);
}

export async function findBranch(db: Db, id: number): Promise<Branch | null> {
  const row = (await db.query<BranchRow>(`SELECT ${columns} FROM branches WHERE id=$1`, [id])).rows[0];
  return row ? mapBranch(row) : null;
}
export async function createBranch(db: Db, input: BranchInput): Promise<Branch> {
  const result = await db.query<BranchRow>(`INSERT INTO branches (name,code,address,phone,status,tin) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${detailColumns}`, [input.name, input.code, input.address, input.phone, input.status, input.tin ?? ""]);
  return mapBranch(result.rows[0]);
}
export async function updateBranch(db: Db, id: number, input: BranchUpdateInput): Promise<Branch | null> {
  const existing = (await db.query<{ code: string; status: string }>("SELECT code,status FROM branches WHERE id=$1", [id])).rows[0];
  if (!existing) return null;
  // A branch with live bookings or queue visits is locked from being deactivated.
  if (input.status === "inactive" && existing.status !== "inactive") {
    const dependents = await countBranchActiveBookings(db, id);
    if (dependents) throw new BranchError(`This branch is locked: ${dependents} active ${dependents === 1 ? "booking or queue visit depends" : "bookings or queue visits depend"} on it. Complete or cancel ${dependents === 1 ? "it" : "them"} before deactivating it.`, 409);
  }
  if (existing.code === "MAIN" && input.code !== undefined && input.code !== "MAIN") {
    throw new BranchError("The MAIN branch code is reserved and cannot be changed", 409);
  }
  const result = await db.query<BranchRow>(`UPDATE branches SET name=COALESCE($2,name), code=COALESCE($3,code), address=COALESCE($4,address), phone=COALESCE($5,phone), status=COALESCE($6,status), tin=COALESCE($7,tin), updated_at=NOW() WHERE id=$1 RETURNING ${detailColumns}`, [id, input.name, input.code, input.address, input.phone, input.status, input.tin]);
  return result.rows[0] ? mapBranch(result.rows[0]) : null;
}
export async function listBranchStaff(db: Db): Promise<BranchStaff[]> {
  return (await db.query<BranchStaff>(`SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL AND r.name IN ('manager','front_desk') ORDER BY u.first_name,u.last_name,u.id`)).rows;
}
export async function listAssignments(db: Db, branchId: number): Promise<BranchAssignment[]> {
  const result = await db.query<{ user_id: number; branch_id: number; is_primary: boolean; created_at: Date; updated_at: Date; first_name: string; last_name: string; role: BranchStaff["role"] }>(`SELECT ub.*, u.first_name, u.last_name, r.name AS role FROM user_branches ub JOIN users u ON u.id=ub.user_id JOIN roles r ON r.id=u.role_id WHERE ub.branch_id=$1 AND u.deleted_at IS NULL AND r.name IN ('manager','front_desk') ORDER BY u.first_name,u.last_name,u.id`, [branchId]);
  return result.rows.map((row) => ({ userId: row.user_id, branchId: row.branch_id, isPrimary: row.is_primary, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), staff: { id: row.user_id, firstName: row.first_name, lastName: row.last_name, role: row.role } }));
}

// Every membership mutation locks the same user row before touching assignments.
// This serializes primary changes across branches, including concurrent requests.
export async function mutateAssignment(db: Pool, branchId: number, userId: number, action: "assign" | "remove" | "primary", isPrimary = false, actorId?: number): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (actorId !== undefined) {
      await client.query("SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",[[actorId,userId]]);
      const actor=(await client.query<{role:string}>("SELECT r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified AND NOT u.is_blocked",[actorId])).rows[0];
      if(actor?.role!=="administrator") throw new BranchError("Administrator access is required",403);
    }
    const user = (await client.query<{ role: string; deleted_at: Date | null }>(`SELECT r.name AS role,u.deleted_at FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 FOR UPDATE OF u`, [userId])).rows[0];
    if (!user || user.deleted_at !== null) throw new BranchError("Staff account not found", 404);
    if (user.role !== "manager" && user.role !== "front_desk") throw new BranchError("Only Managers and Front Desk can be assigned", 400);
    if (!await findBranch(client, branchId)) throw new BranchError("Branch not found", 404);
    const existing = await client.query("SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id=$2", [userId, branchId]);
    if (action === "assign" && existing.rowCount) throw new BranchError("Staff is already assigned to this branch", 409);
    if (action !== "assign" && !existing.rowCount) throw new BranchError("Assignment not found", 404);
    if (action === "remove") {
      await client.query("DELETE FROM user_branches WHERE user_id=$1 AND branch_id=$2", [userId, branchId]);
    } else {
      if (isPrimary || action === "primary") await client.query("UPDATE user_branches SET is_primary=FALSE,updated_at=NOW() WHERE user_id=$1 AND is_primary", [userId]);
      if (action === "assign") await client.query("INSERT INTO user_branches (user_id,branch_id,is_primary) VALUES ($1,$2,$3)", [userId, branchId, isPrimary]);
      else await client.query("UPDATE user_branches SET is_primary=TRUE,updated_at=NOW() WHERE user_id=$1 AND branch_id=$2", [userId, branchId]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
