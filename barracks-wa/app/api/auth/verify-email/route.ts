import { z } from "zod";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { getVerificationStatus, issueVerificationCode, verifyEmailCode } from "@/server/services/email-verification.service";
import { mailConfigured } from "@/server/services/mailer";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict(),
  z.object({ resend: z.literal(true) }).strict(),
]);

// Whether the signed-in customer's email is verified.
export async function GET() {
  const user = await requireRolesUser(["customer"]);
  if (user instanceof Response) return user;
  try {
    const status = await getVerificationStatus(pool, user.id);
    if (!status) return Response.json({ success: false, message: "Account not found" }, { status: 404 });
    return Response.json({ success: true, ...status, emailDelivery: mailConfigured() });
  } catch (error) {
    console.error("Unable to load email verification", error);
    return Response.json({ success: false, message: "Unable to load email verification" }, { status: 500 });
  }
}

// { code } verifies the email; { resend: true } sends a new code.
export async function POST(request: Request) {
  const user = await requireRolesUser(["customer"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Enter the 6-digit code" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Enter the 6-digit code" }, { status: 400 });
  try {
    if ("resend" in parsed.data) {
      const sent = await issueVerificationCode(pool, user.id);
      if (sent.kind === "already_verified") return Response.json({ success: true, verified: true });
      if (sent.kind === "wait")
        return Response.json({ success: false, message: `Wait ${sent.retryAfterSeconds} seconds before requesting another code` }, { status: 429 });
      if (sent.kind === "not_found") return Response.json({ success: false, message: "Account not found" }, { status: 404 });
      return Response.json({ success: true, verified: false, message: `A new code was sent to ${user.email}` });
    }
    const result = await verifyEmailCode(pool, user.id, parsed.data.code);
    if (result === "verified" || result === "already_verified") return Response.json({ success: true, verified: true });
    const message = result === "expired" ? "That code has expired. Request a new one"
      : result === "too_many_attempts" ? "Too many incorrect attempts. Request a new code"
      : result === "no_code" ? "Request a verification code first"
      : "That code is incorrect";
    return Response.json({ success: false, message }, { status: result === "too_many_attempts" ? 429 : 400 });
  } catch (error) {
    console.error("Unable to verify email", error);
    return Response.json({ success: false, message: "Unable to verify email right now" }, { status: 500 });
  }
}
