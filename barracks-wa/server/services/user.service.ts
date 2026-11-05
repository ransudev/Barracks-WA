import type { Pool, PoolClient } from "pg";
import { canCreateStaffUser, canViewStaffUser, canUpdateStaffUser, canChangeStaffLifecycle } from "@/app/constants/roles";
import { hashPassword } from "@/server/services/password.service";
import type {
  CreateUserInput,
  UpdateStaffUserInput,
  UserLifecycleInput,
  UserRole,
} from "@/server/schemas/user.schema";

type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
  role_description: string;
  is_verified: boolean;
  is_blocked: boolean;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AuthenticatedUserRow = UserRow & {
  password_hash: string;
};

export type PublicUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  isBlocked: boolean;
  isActive: boolean;
  branchIds?: number[];
  canManageAccount?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthenticatedUser = {
  user: PublicUser;
  passwordHash: string;
};

export type CreateUserResult =
  | { kind: "created"; user: PublicUser }
  | { kind: "duplicate" }
  | { kind: "invalid_role" }
  | { kind: "forbidden" };

export type UserMutationResult =
  | { kind: "updated"; user: PublicUser }
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "duplicate" }
  | { kind: "invalid_role" }
  | { kind: "last_admin" }
  | { kind: "forbidden" };

const USER_ADMIN_LOCK_KEY = 918273;

const userSelect = `
  SELECT
    u.id,
    u.first_name,
    u.last_name,
    u.email,
    r.name AS role,
    r.description AS role_description,
    u.is_verified,
    u.is_blocked,
    u.deleted_at,
    u.created_at,
    u.updated_at
  FROM users u
  INNER JOIN roles r ON r.id = u.role_id
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    isVerified: Boolean(row.is_verified),
    isBlocked: Boolean(row.is_blocked),
    isActive: row.deleted_at === null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function lockAdministratorMutations(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [USER_ADMIN_LOCK_KEY]);
}

async function usableAdministratorCount(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM users u
    INNER JOIN roles r ON r.id = u.role_id AND r.name = 'administrator'
    WHERE u.deleted_at IS NULL
      AND u.is_verified = TRUE
      AND u.is_blocked = FALSE
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export async function listUsers(db: Pool): Promise<PublicUser[]> {
  const result = await db.query<UserRow>(
    `${userSelect}
      WHERE r.name IN ('administrator', 'manager', 'front_desk')
        AND u.deleted_at IS NULL
      ORDER BY u.created_at DESC, u.id DESC`,
  );
  return result.rows.map(toPublicUser);
}

// All HTTP staff actions use these entrypoints. Bootstrap createUser remains
// available for the seed/admin setup path, which has no authenticated actor.
async function lockStaffAuthority(client: PoolClient, actorId: number, targetId = actorId): Promise<UserRow | undefined> {
  await client.query("SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [[actorId, targetId]]);
  const actor = (await client.query<UserRow>(`${userSelect} WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified AND NOT u.is_blocked`, [actorId])).rows[0];
  return actor && (actor.role === "administrator" || actor.role === "manager") ? actor : undefined;
}

async function staffScope(client: PoolClient, actor: UserRow, target: UserRow): Promise<{ branchIds: number[]; canManageAccount: boolean; visible: boolean }> {
  const memberships = (await client.query<{branch_id:number}>("SELECT branch_id FROM user_branches WHERE user_id=$1 ORDER BY branch_id", [target.id])).rows.map(row=>Number(row.branch_id));
  const authority = new Set((await client.query<{branch_id:number}>("SELECT branch_id FROM user_branches WHERE user_id=$1", [actor.id])).rows.map(row=>Number(row.branch_id)));
  const global = actor.role === "administrator";
  return { branchIds: global ? memberships : memberships.filter(id=>authority.has(id)),
    visible: canViewStaffUser(actor.role,target.role) && (global || memberships.some(id=>authority.has(id))),
    canManageAccount: global || (memberships.length>0 && memberships.every(id=>authority.has(id))) };
}

async function staffRead(db: Pool, actorId: number, targetId?: number): Promise<PublicUser[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await lockStaffAuthority(client,actorId);
    if (!actor) { await client.query("ROLLBACK"); return []; }
    const scopedSelect = userSelect.replace("    u.updated_at", `    u.updated_at,
      ARRAY(SELECT ub.branch_id FROM user_branches ub WHERE ub.user_id=u.id AND
        ($3::boolean OR EXISTS(SELECT 1 FROM user_branches ab WHERE ab.user_id=$1 AND ab.branch_id=ub.branch_id)) ORDER BY ub.branch_id) AS branch_ids,
      ($3::boolean OR (EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=u.id) AND
        NOT EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=u.id AND NOT EXISTS
          (SELECT 1 FROM user_branches ab WHERE ab.user_id=$1 AND ab.branch_id=ub.branch_id)))) AS can_manage`);
    const rows = (await client.query<UserRow & {branch_ids:number[];can_manage:boolean}>(`${scopedSelect}
      WHERE u.deleted_at IS NULL AND r.name IN ('administrator','manager','front_desk')
      AND ($2::int IS NULL OR u.id=$2)
      AND ($3::boolean OR (r.name='front_desk' AND EXISTS(SELECT 1 FROM user_branches ub
        JOIN user_branches ab ON ab.branch_id=ub.branch_id AND ab.user_id=$1 WHERE ub.user_id=u.id)))
      ORDER BY u.created_at DESC,u.id DESC`, [actorId,targetId ?? null,actor.role==='administrator'])).rows;
    const result = rows.map(row=>({...toPublicUser(row),branchIds:row.branch_ids.map(Number),canManageAccount:row.can_manage}));
    await client.query("COMMIT"); return result;
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function listStaffBranches(db: Pool, actorId: number): Promise<Array<{id:number;name:string}>> {
  return (await db.query<{id:number;name:string}>(`SELECT b.id,b.name FROM branches b
    JOIN users u ON u.id=$1 AND u.deleted_at IS NULL AND u.is_verified AND NOT u.is_blocked
    JOIN roles r ON r.id=u.role_id WHERE r.name='administrator' OR
    (r.name='manager' AND EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=u.id AND ub.branch_id=b.id)) ORDER BY b.name,b.id`,[actorId])).rows;
}
export async function listStaffUsers(db: Pool, actorId: number): Promise<PublicUser[]> { return staffRead(db,actorId); }
export async function findStaffUserById(db: Pool, actorId: number,id: number): Promise<PublicUser|null> { return (await staffRead(db,actorId,id))[0] ?? null; }

export async function findUserByEmail(
  db: Pool,
  email: string,
): Promise<AuthenticatedUser | null> {
  const result = await db.query<AuthenticatedUserRow>(
    `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.password_hash,
        r.name AS role,
        r.description AS role_description,
        u.is_verified,
        u.is_blocked,
        u.deleted_at,
        u.created_at,
        u.updated_at
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1)
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [email],
  );
  const row = result.rows[0];

  return row
    ? {
        user: toPublicUser(row),
        passwordHash: row.password_hash,
      }
    : null;
}

export async function findUserById(db: Pool, id: number): Promise<PublicUser | null> {
  const result = await db.query<UserRow>(
    `${userSelect} WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
  return result.rows[0] ? toPublicUser(result.rows[0]) : null;
}

export async function createUser(
  db: Pool,
  input: CreateUserInput & { branchIds?: number[] },
  actorId?: number,
): Promise<CreateUserResult> {
  // Hash first: this is slow and must not hold a connection or transaction open.
  const passwordHash = await hashPassword(input.password);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    if (actorId !== undefined) {
      const actor=await lockStaffAuthority(client,actorId);
      const branches=input.branchIds ?? [];
      const authority=new Set((await client.query<{branch_id:number}>("SELECT branch_id FROM user_branches WHERE user_id=$1",[actorId])).rows.map(row=>Number(row.branch_id)));
      const validBranches=(await client.query("SELECT id FROM branches WHERE id=ANY($1::int[])",[branches])).rowCount===branches.length;
      if (!actor || !canCreateStaffUser(actor.role,input.role) || (input.role === "administrator" && branches.length>0) || !validBranches || (actor.role==="manager" && (!branches.length || branches.some(id=>!authority.has(id))))) {
        await client.query("ROLLBACK"); return {kind:"forbidden"};
      }
    }

    const existingUser = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1",
      [input.email],
    );

    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "duplicate" };
    }

    const role = await client.query<{ id: number }>(
      "SELECT id FROM roles WHERE name = $1 AND name IN ('administrator', 'manager', 'front_desk') LIMIT 1",
      [input.role],
    );

    if (!role.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "invalid_role" };
    }

    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO users
          (first_name, last_name, email, password_hash, role_id, is_verified, is_blocked)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE)
        RETURNING id
      `,
      [input.firstName, input.lastName, input.email, passwordHash, role.rows[0].id, input.role === "administrator"],
    );

    for (const branchId of input.branchIds ?? []) {
      await client.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,$3)",[inserted.rows[0].id,branchId,branchId===input.branchIds?.[0]]);
    }
    const created = await client.query<UserRow>(
      `${userSelect} WHERE u.id = $1`,
      [inserted.rows[0].id],
    );

    await client.query("COMMIT");
    return { kind: "created", user: {...toPublicUser(created.rows[0]), ...(actorId===undefined ? {} : {branchIds:input.branchIds ?? [], canManageAccount:true})} };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (isUniqueViolation(error)) {
      return { kind: "duplicate" };
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function updateStaffUser(
  db: Pool,
  id: number,
  input: UpdateStaffUserInput,
  actorId: number,
): Promise<UserMutationResult> {
  // Hash first: this is slow and must not hold a connection or transaction open.
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await lockAdministratorMutations(client);
    const actor=await lockStaffAuthority(client,actorId,id);
    if (!actor) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    const current = await client.query<UserRow>(
      `${userSelect}
        WHERE u.id = $1
          AND u.deleted_at IS NULL
          AND r.name IN ('administrator', 'manager', 'front_desk')
        FOR UPDATE OF u`,
      [id],
    );
    const existing = current.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return { kind: "not_found" };
    }

    const scope=await staffScope(client,actor,existing);
    if (!scope.canManageAccount || !canUpdateStaffUser(actor.role,existing.role,actor.id,id,input.role)) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    if (existing.role === "administrator" && input.role !== "administrator" && (await usableAdministratorCount(client)) <= 1) {
      await client.query("ROLLBACK");
      return { kind: "last_admin" };
    }

    const role = await client.query<{ id: number }>(
      "SELECT id FROM roles WHERE name = $1 AND name IN ('administrator', 'manager', 'front_desk') LIMIT 1",
      [input.role],
    );
    if (!role.rows[0]) {
      await client.query("ROLLBACK");
      return { kind: "invalid_role" };
    }

    if (passwordHash) {
      await client.query(
        `
          UPDATE users
          SET first_name = $1, last_name = $2, email = $3, role_id = $4,
              password_hash = $5, updated_at = NOW()
          WHERE id = $6
        `,
        [input.firstName, input.lastName, input.email, role.rows[0].id, passwordHash, id],
      );
      await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    } else {
      await client.query(
        `
          UPDATE users
          SET first_name = $1, last_name = $2, email = $3, role_id = $4,
              updated_at = NOW()
          WHERE id = $5
        `,
        [input.firstName, input.lastName, input.email, role.rows[0].id, id],
      );
    }

    const updated = await client.query<UserRow>(`${userSelect} WHERE u.id = $1`, [id]);
    await client.query("COMMIT");
    return { kind: "updated", user: {...toPublicUser(updated.rows[0]),branchIds:scope.branchIds,canManageAccount:scope.canManageAccount} };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isUniqueViolation(error)) return { kind: "duplicate" };
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserLifecycle(
  db: Pool,
  id: number,
  input: UserLifecycleInput,
  actorId: number,
): Promise<UserMutationResult> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await lockAdministratorMutations(client);
    const actor=await lockStaffAuthority(client,actorId,id);
    if (!actor) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    const current = await client.query<UserRow>(
      `${userSelect}
        WHERE u.id = $1
          AND u.deleted_at IS NULL
          AND r.name IN ('administrator', 'manager', 'front_desk')
        FOR UPDATE OF u`,
      [id],
    );
    const existing = current.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return { kind: "not_found" };
    }

    const nextVerified = input.action === "verify" || input.action === "unblock"
      ? input.action === "verify" ? true : existing.is_verified
      : input.action === "unverify" ? false : existing.is_verified;
    const nextBlocked = input.action === "block"
      ? true
      : input.action === "unblock" ? false : existing.is_blocked;
    const disablesAccount = !nextVerified || nextBlocked;

    const scope=await staffScope(client,actor,existing);
    if (!scope.canManageAccount || !canChangeStaffLifecycle(actor.role,existing.role,actor.id,id)) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    if (existing.role === "administrator" && disablesAccount && (await usableAdministratorCount(client)) <= 1) {
      await client.query("ROLLBACK");
      return { kind: "last_admin" };
    }

    await client.query(
      `
        UPDATE users
        SET is_verified = $1, is_blocked = $2, updated_at = NOW()
        WHERE id = $3
      `,
      [nextVerified, nextBlocked, id],
    );

    if (disablesAccount) {
      await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    }

    const updated = await client.query<UserRow>(`${userSelect} WHERE u.id = $1`, [id]);
    await client.query("COMMIT");
    return { kind: "updated", user: {...toPublicUser(updated.rows[0]),branchIds:scope.branchIds,canManageAccount:scope.canManageAccount} };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function softDeleteUser(db: Pool, id: number, actorId: number): Promise<UserMutationResult> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await lockAdministratorMutations(client);
    const actor=await lockStaffAuthority(client,actorId,id);
    if (!actor) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    const current = await client.query<UserRow>(`${userSelect} WHERE u.id=$1 AND u.deleted_at IS NULL FOR UPDATE OF u`,[id]);
    const existing = current.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return { kind: "not_found" };
    }

    const scope=await staffScope(client,actor,existing);
    if (!scope.canManageAccount || !canChangeStaffLifecycle(actor.role,existing.role,actor.id,id)) { await client.query("ROLLBACK"); return {kind:"forbidden"}; }

    if (existing.role === "administrator" && (await usableAdministratorCount(client)) <= 1) {
      await client.query("ROLLBACK");
      return { kind: "last_admin" };
    }

    const deleted = await client.query<{ id: number }>(
      `
        UPDATE users
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `,
      [id],
    );

    if (!deleted.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "not_found" };
    }

    await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    await client.query("COMMIT");
    return { kind: "deleted" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

export async function createStaffUser(db: Pool, actorId: number, input: CreateUserInput & {branchIds: number[]}): Promise<CreateUserResult> {
  if (!Number.isSafeInteger(actorId) || actorId < 1) return {kind:"forbidden"};
  return createUser(db,input,actorId);
}
