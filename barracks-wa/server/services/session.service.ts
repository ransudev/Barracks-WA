import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Db } from "@/server/db/transaction";
import type { PublicUser } from "@/server/services/user.service";

export const SESSION_COOKIE_NAME = "barracks_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Pool,
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.query("DELETE FROM sessions WHERE expires_at <= NOW()");
  await db.query(
    `
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, $3)
    `,
    [hashSessionToken(token), userId, expiresAt],
  );

  return { token, expiresAt };
}

export async function findUserBySessionToken(
  db: Pool,
  token: string,
): Promise<PublicUser | null> {
  const result = await db.query<{
    id: number;
    first_name: string;
    last_name: string;
    email: string;
      role: PublicUser["role"];
    is_verified: boolean;
    is_blocked: boolean;
    deleted_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
  }>(
    `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        r.name AS role,
        u.is_verified,
        u.is_blocked,
        u.deleted_at,
        u.created_at,
        u.updated_at
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      INNER JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.deleted_at IS NULL
        AND u.is_verified = TRUE
        AND u.is_blocked = FALSE
        -- A deactivated supplier company blocks every login linked to it.
        AND (r.name <> 'supplier' OR EXISTS (
          SELECT 1 FROM supplier_accounts sa
          INNER JOIN suppliers sp ON sp.id = sa.supplier_id AND sp.status = 'active'
          WHERE sa.user_id = u.id))
      LIMIT 1
    `,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];

  return row
    ? {
        id: Number(row.id),
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        role: row.role,
        isVerified: Boolean(row.is_verified),
        isBlocked: Boolean(row.is_blocked),
        isActive: row.deleted_at === null,
        createdAt: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
        updatedAt: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
      }
    : null;
}

export async function deleteOtherSessions(db: Db, userId: number, keepToken?: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [
    userId,
    keepToken ? hashSessionToken(keepToken) : "",
  ]);
}

export async function deleteSession(db: Pool, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [
    hashSessionToken(token),
  ]);
}
