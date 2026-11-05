import { NextResponse } from "next/server";
import { clientIp, consumeAuthAttempts, signupRules, tooManyAttempts } from "@/server/auth/auth-throttle";
import { startSession } from "@/server/auth/session";
import { pool } from "@/server/db/pool";
import {
  customerSignupSchema,
  formatValidationErrors,
} from "@/server/schemas/sprint.schema";
import { createCustomer } from "@/server/services/customer.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid signup information" },
      { status: 400 },
    );
  }

  const parsed = customerSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid signup information",
        errors: formatValidationErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  try {
    const throttle = await consumeAuthAttempts(pool, signupRules(clientIp(request)));
    if (!throttle.allowed) return tooManyAttempts(throttle.retryAfterSeconds);

    const result = await createCustomer(pool, parsed.data);
    if (result.kind === "duplicate") {
      return NextResponse.json(
        { success: false, message: "A customer with this email already exists" },
        { status: 409 },
      );
    }

    const response = NextResponse.json(
      {
        success: true,
        message: "Customer account created",
        user: {
          id: result.customer.userId,
          firstName: result.customer.firstName,
          lastName: result.customer.lastName,
          email: result.customer.email,
          role: "customer",
          createdAt: result.customer.createdAt,
          updatedAt: result.customer.updatedAt,
        },
      },
      { status: 201 },
    );
    await startSession(response, result.customer.userId);
    return response;
  } catch (error) {
    console.error("Unable to create customer account", error);
    return NextResponse.json(
      { success: false, message: "Unable to create customer account" },
      { status: 500 },
    );
  }
}
