import { NextResponse } from "next/server";
import { clearLoginAttempts, clientIp, consumeAuthAttempts, loginRules, tooManyAttempts } from "@/server/auth/auth-throttle";
import { startSession } from "@/server/auth/session";
import { pool } from "@/server/db/pool";
import {
  formatValidationErrors,
  loginSchema,
} from "@/server/schemas/user.schema";
import { findUserByEmail } from "@/server/services/user.service";
import { verifyPassword } from "@/server/services/password.service";
import { supplierIdForUser } from "@/server/services/supplier.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid login information",
        errors: { body: ["Request body must be valid JSON"] },
      },
      { status: 400 },
    );
  }

  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid login information",
        errors: formatValidationErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  try {
    const ip = clientIp(request);
    const throttle = await consumeAuthAttempts(pool, loginRules(parsed.data.email, ip));
    if (!throttle.allowed) return tooManyAttempts(throttle.retryAfterSeconds);

    const account = await findUserByEmail(pool, parsed.data.email);

    if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid email or password",
        },
        { status: 401 },
      );
    }

    await clearLoginAttempts(pool, parsed.data.email, ip);

    if (!account.user.isVerified || account.user.isBlocked || !account.user.isActive) {
      return NextResponse.json(
        {
          success: false,
          message: account.user.isBlocked
            ? "This account is blocked. Contact an administrator."
            : "This account is not verified yet. Contact an administrator.",
        },
        { status: 403 },
      );
    }

    if (account.user.role === "supplier" && !(await supplierIdForUser(pool, account.user.id))) {
      return NextResponse.json(
        { success: false, message: "This supplier account is inactive. Contact the shop administrator." },
        { status: 403 },
      );
    }

    const response = NextResponse.json({
      success: true,
      user: account.user,
    });
    await startSession(response, account.user.id);
    return response;
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unable to sign in",
      },
      { status: 500 },
    );
  }
}
