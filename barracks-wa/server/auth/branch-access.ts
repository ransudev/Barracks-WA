import type { Pool, PoolClient } from "pg";
import type { PublicUser } from "@/server/services/user.service";
import { BranchError, findBranch, listBranches, listAssignedBranches } from "@/server/services/branch.service";
import { inTransaction, type Db } from "@/server/db/transaction";
import type { Branch } from "@/app/types/branch";

// Every branch-isolation check lives in this module. Routes and services call
// these helpers; the database only stores branch ownership and memberships.
export type BranchActor = Pick<PublicUser, "id" | "role">;
export const isBranchStaff = (role: string) => role === "manager" || role === "front_desk";

// Membership includes active and inactive branches. Phase 2 uses these checks
// for barbers and scheduling; activation policies remain deferred.
export async function listAccessibleBranches(db: Db, actor: BranchActor): Promise<Branch[]> {
  if (actor.role === "administrator") return listBranches(db);
  if (!isBranchStaff(actor.role)) return [];
  return listAssignedBranches(db, actor.id);
}
export async function checkBranchAccess(db: Db, actor: BranchActor, branchId: number): Promise<boolean> {
  if (actor.role !== "administrator" && !isBranchStaff(actor.role)) return false;
  return Boolean((await db.query(`SELECT 1 FROM branches b WHERE b.id=$1
    AND ($2::boolean OR EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id=$3 AND ub.branch_id=b.id))`,
    [branchId, actor.role === "administrator", actor.id])).rowCount);
}
export async function requireBranchAccess(db: Db, actor: BranchActor, branchId: number): Promise<void> {
  if (!await checkBranchAccess(db, actor, branchId)) throw new BranchError("You do not have access to this branch", 403);
}
export async function getPrimaryBranch(db: Db, actor: BranchActor): Promise<Branch | null> {
  if (!isBranchStaff(actor.role)) return null;
  const row = (await db.query<{ branch_id: number }>("SELECT branch_id FROM user_branches WHERE user_id=$1 AND is_primary", [actor.id])).rows[0];
  return row ? findBranch(db, row.branch_id) : null;
}

export const branchIdParam = (request: Request) => new URL(request.url).searchParams.get("branchId");

// Staff operational pages: an explicit ?branchId= must be accessible; otherwise
// use the primary, then the first active, assigned branch.
export async function resolveOperationalBranch(db: Db, actor: BranchActor, rawId: string | null): Promise<number> {
  if (rawId !== null) {
    const id = Number(rawId);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) throw new BranchError("Invalid branch", 400);
    await requireBranchAccess(db, actor, id);
    return id;
  }
  const primary = await getPrimaryBranch(db, actor);
  const branches = await listAccessibleBranches(db, actor);
  const branch = primary ?? branches.find((item) => item.status === "active") ?? branches[0];
  if (!branch) throw new BranchError("No assigned branch is available", 403);
  return branch.id;
}

// Customer selection is separate from staff assignments and branch context.
export async function resolveCustomerBranch(db: Pool | PoolClient, raw: string | null): Promise<number> {
  if (raw !== null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 2147483647)) {
    throw new BranchError("Invalid branch", 400);
  }
  const row = (await db.query<{ id: number; status: string }>(
    raw === null ? "SELECT id,status FROM branches WHERE code='MAIN'" : "SELECT id,status FROM branches WHERE id=$1",
    raw === null ? [] : [Number(raw)],
  )).rows[0];
  if (!row || row.status !== "active") throw new BranchError("Choose an active branch", 400);
  return Number(row.id);
}

export async function visitBranch(db: Pool, actor: BranchActor, request: Request): Promise<number> {
  const raw = branchIdParam(request);
  if (actor.role !== "customer") return resolveOperationalBranch(db, actor, raw);
  return resolveCustomerBranch(db, raw);
}

// Missing selection aggregates accessible branches. Only Administrators may
// explicitly request all branches. An empty membership never removes the filter.
export async function resolveReportBranches(db: Pool, actor: BranchActor, raw: string | null): Promise<number[]> {
  if (!["administrator", "manager", "front_desk"].includes(actor.role))
    throw new BranchError("You do not have access to reports", 403);
  if (raw === "all" && actor.role !== "administrator")
    throw new BranchError("Only Administrators can view all branches", 403);
  if (raw !== null && raw !== "all") {
    const id = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) throw new BranchError("Invalid branch", 400);
    await requireBranchAccess(db, actor, id);
    return [id];
  }
  return (await listAccessibleBranches(db, actor)).map((branch) => branch.id);
}

export function requireManagementReport(actor: BranchActor) {
  if (actor.role !== "administrator" && actor.role !== "manager")
    throw new BranchError("You do not have access to reports", 403);
}

export async function withAuthorizedBarber<T>(db: Db, actor: BranchActor, id: number, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(db, async (client) => {
    // Keep ownership stable until the read or mutation finishes, including absences.
    const row = (await client.query<{ branch_id: number }>("SELECT branch_id FROM barbers WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new BranchError("Barber not found", 404);
    await requireBranchAccess(client, actor, row.branch_id);
    return work(client);
  });
}

export async function withInventoryOwner<T>(db: Db, actor: BranchActor, request: Request,
  table: "inventory_items" | "restock_requests", id: number, work: (client: PoolClient, branchId: number) => Promise<T>) {
  return inTransaction(db, async (client) => {
    const row = (await client.query<{ branch_id: number }>(`SELECT branch_id FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new BranchError(table === "inventory_items" ? "Inventory item not found" : "Restock request not found", 404);
    await requireBranchAccess(client, actor, row.branch_id);
    const raw = branchIdParam(request);
    if (raw !== null && await resolveOperationalBranch(client, actor, raw) !== row.branch_id)
      throw new BranchError("Record does not belong to the selected branch", 403);
    return work(client, Number(row.branch_id));
  });
}

// Membership mutations lock users too. Acquire this before visit/barber locks
// and keep the current actor's authority stable until the transaction commits.
export async function lockOperationalActor(client: PoolClient, actor?: BranchActor): Promise<BranchActor | undefined> {
  if (!actor) return undefined; // Internal callers; HTTP routes always supply actor.
  const row = (await client.query<{ role: BranchActor["role"] }>(`SELECT r.name AS role FROM users u
    JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.deleted_at IS NULL
    AND u.is_verified AND NOT u.is_blocked FOR SHARE OF u`, [actor.id])).rows[0];
  if (!row || !["administrator", "manager", "front_desk"].includes(row.role)) throw new BranchError("Staff access is required", 403);
  return { id: actor.id, role: row.role };
}

// The HTTP form of a BranchError; other errors stay with the caller's handler.
export function branchErrorResponse(error: unknown): Response | null {
  return error instanceof BranchError
    ? Response.json({ success: false, message: error.message }, { status: error.status }) : null;
}

export function visitBranchError(error: unknown): Response | null {
  const branchResponse = branchErrorResponse(error);
  if (branchResponse) return branchResponse;
  if (error && typeof error === "object" && "code" in error && error.code === "23514")
    return Response.json({ success: false, message: "Barber and visit must belong to the same branch" }, { status: 409 });
  return null;
}
