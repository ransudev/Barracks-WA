import { createHash } from "node:crypto";
import type { Pool } from "pg";

type ThrottleRule = { key: string; limit: number; windowSeconds: number };
export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const LOGIN_WINDOW_SECONDS = 15 * 60;
const SIGNUP_WINDOW_SECONDS = 60 * 60;

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

// Hosting proxies set this header. A forged value only affects the IP-based
// rules, because the per-account login rule does not use the address.
export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

// A wrong guess from one address stops early, so an attacker elsewhere cannot
// easily lock out the real user. The higher account limit covers guesses spread
// across many addresses.
function accountRules(email: string, ip: string | null): ThrottleRule[] {
  const account = email.trim().toLowerCase();
  return [
    { key: `login:account:${account}`, limit: 30, windowSeconds: LOGIN_WINDOW_SECONDS },
    ...(ip ? [{ key: `login:account-ip:${account}:${ip}`, limit: 10, windowSeconds: LOGIN_WINDOW_SECONDS }] : []),
  ];
}

export function loginRules(email: string, ip: string | null): ThrottleRule[] {
  return [
    ...accountRules(email, ip),
    ...(ip ? [{ key: `login:ip:${ip}`, limit: 100, windowSeconds: LOGIN_WINDOW_SECONDS }] : []),
  ];
}

export function signupRules(ip: string | null): ThrottleRule[] {
  return ip ? [{ key: `signup:ip:${ip}`, limit: 10, windowSeconds: SIGNUP_WINDOW_SECONDS }] : [];
}

// Counts the attempt before any password work. If the counters cannot be used,
// sign-in stays available and the failure is logged.
export async function consumeAuthAttempts(db: Pool, rules: ThrottleRule[]): Promise<ThrottleResult> {
  if (!rules.length) return { allowed: true };
  // A consistent key order stops concurrent attempts from deadlocking.
  const limits = rules.map((rule) => ({ ...rule, keyHash: hashKey(rule.key) }))
    .sort((a, b) => a.keyHash.localeCompare(b.keyHash));
  try {
    await db.query("DELETE FROM auth_attempts WHERE expires_at <= NOW()");
    const result = await db.query<{ key_hash: string; attempts: number; retry_after: number }>(
      `INSERT INTO auth_attempts (key_hash, attempts, expires_at)
       SELECT key_hash, 1, NOW() + window_seconds * INTERVAL '1 second'
       FROM unnest($1::text[], $2::integer[]) AS input(key_hash, window_seconds)
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE WHEN auth_attempts.expires_at <= NOW() THEN 1 ELSE auth_attempts.attempts + 1 END,
         expires_at = CASE WHEN auth_attempts.expires_at <= NOW() THEN EXCLUDED.expires_at ELSE auth_attempts.expires_at END
       RETURNING key_hash, attempts, CEIL(EXTRACT(EPOCH FROM expires_at - NOW()))::integer AS retry_after`,
      [limits.map((limit) => limit.keyHash), limits.map((limit) => limit.windowSeconds)],
    );
    const exceeded = result.rows.filter((row) =>
      row.attempts > (limits.find((limit) => limit.keyHash === row.key_hash)?.limit ?? Number.POSITIVE_INFINITY));
    return exceeded.length
      ? { allowed: false, retryAfterSeconds: Math.max(...exceeded.map((row) => row.retry_after), 1) }
      : { allowed: true };
  } catch (error) {
    console.error("Unable to check auth attempt limits", error);
    return { allowed: true };
  }
}

// The address-wide counter stays, so one address cannot try many accounts while
// resetting its count with its own successful logins.
export async function clearLoginAttempts(db: Pool, email: string, ip: string | null): Promise<void> {
  try {
    await db.query("DELETE FROM auth_attempts WHERE key_hash = ANY($1::text[])",
      [accountRules(email, ip).map((rule) => hashKey(rule.key))]);
  } catch (error) {
    console.error("Unable to clear auth attempt limits", error);
  }
}

export function tooManyAttempts(retryAfterSeconds: number): Response {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return Response.json(
    { success: false, message: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
