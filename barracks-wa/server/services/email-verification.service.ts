import { createHash, randomInt } from "node:crypto";
import type { Db } from "@/server/db/transaction";
import { sendMail } from "@/server/services/mailer";

// A customer proves they own their email with a 6-digit code sent to it.
export const VERIFICATION_CODE_MINUTES = 15;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const VERIFICATION_RESEND_SECONDS = 60;

export type VerificationStatus = { verified: boolean; email: string; pending: boolean };
export type VerifyResult = "verified" | "already_verified" | "wrong_code" | "expired" | "too_many_attempts" | "no_code";

const hashCode = (userId: number, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

export async function getVerificationStatus(db: Db, userId: number): Promise<VerificationStatus | null> {
  const result = await db.query<{ email: string; verified: boolean; pending: boolean }>(
    `SELECT u.email, u.email_verified_at IS NOT NULL AS verified,
       EXISTS (SELECT 1 FROM email_verification_codes c WHERE c.user_id=u.id AND c.expires_at > NOW()) AS pending
     FROM users u WHERE u.id=$1 AND u.deleted_at IS NULL`, [userId]);
  return result.rows[0] ?? null;
}

// Create (or replace) the pending code and email it. Returns the code so that
// callers running without an email provider, and tests, can use it.
export async function issueVerificationCode(db: Db, userId: number, options: { force?: boolean } = {}): Promise<
  { kind: "sent"; code: string; delivered: boolean } | { kind: "already_verified" } | { kind: "wait"; retryAfterSeconds: number } | { kind: "not_found" }> {
  const user = await db.query<{ email: string; verified: boolean }>(
    "SELECT email, email_verified_at IS NOT NULL AS verified FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
  if (!user.rows[0]) return { kind: "not_found" };
  if (user.rows[0].verified) return { kind: "already_verified" };
  if (!options.force) {
    const recent = await db.query<{ wait: number }>(
      "SELECT CEIL($2 - EXTRACT(EPOCH FROM (NOW() - sent_at)))::int AS wait FROM email_verification_codes WHERE user_id=$1", [userId, VERIFICATION_RESEND_SECONDS]);
    if (recent.rows[0] && recent.rows[0].wait > 0) return { kind: "wait", retryAfterSeconds: recent.rows[0].wait };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.query(
    `INSERT INTO email_verification_codes(user_id,email,code_hash,attempts,sent_at,expires_at)
     VALUES($1,$2,$3,0,NOW(),NOW() + ($4::integer * INTERVAL '1 minute'))
     ON CONFLICT (user_id) DO UPDATE SET email=EXCLUDED.email, code_hash=EXCLUDED.code_hash, attempts=0,
       sent_at=EXCLUDED.sent_at, expires_at=EXCLUDED.expires_at`,
    [userId, user.rows[0].email, hashCode(userId, code), VERIFICATION_CODE_MINUTES]);
  const { delivered } = await sendMail({
    to: user.rows[0].email,
    subject: "Your Barracks verification code",
    text: `Your Barracks verification code is ${code}. It expires in ${VERIFICATION_CODE_MINUTES} minutes.`,
  });
  return { kind: "sent", code, delivered };
}

export async function verifyEmailCode(db: Db, userId: number, code: string): Promise<VerifyResult> {
  const status = await getVerificationStatus(db, userId);
  if (!status) return "no_code";
  if (status.verified) return "already_verified";
  // Count the attempt first so parallel guesses cannot exceed the limit.
  const pending = await db.query<{ code_hash: string; attempts: number; expired: boolean; email: string }>(
    `UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id=$1
     RETURNING code_hash, attempts, expires_at <= NOW() AS expired, email`, [userId]);
  const row = pending.rows[0];
  if (!row) return "no_code";
  if (row.expired) return "expired";
  if (row.attempts > VERIFICATION_MAX_ATTEMPTS) return "too_many_attempts";
  // The code only proves the address it was sent to.
  if (row.code_hash.trim() !== hashCode(userId, code) || row.email.toLowerCase() !== status.email.toLowerCase()) return "wrong_code";
  await db.query("UPDATE users SET email_verified_at=NOW() WHERE id=$1", [userId]);
  await db.query("DELETE FROM email_verification_codes WHERE user_id=$1", [userId]);
  return "verified";
}

// A changed email address has to be proven again.
export async function resetEmailVerification(db: Db, userId: number): Promise<void> {
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [userId]);
  await db.query("DELETE FROM email_verification_codes WHERE user_id=$1", [userId]);
}

// EMAIL_VERIFICATION_REQUIRED=true makes a verified email a condition for online booking.
export function emailVerificationRequired(): boolean {
  return process.env.EMAIL_VERIFICATION_REQUIRED === "true";
}
