import { getCurrentUser } from "@/server/auth/session";
import { issueVerificationCode, resetEmailVerification } from "@/server/services/email-verification.service";
import { verifyPassword } from "@/server/services/password.service";
import { pool } from "@/server/db/pool";
import {
  customerSelfUpdateSchema,
  formatValidationErrors,
} from "@/server/schemas/sprint.schema";
import {
  CustomerEmailTakenError,
  customerForViewer,
  findCustomerByUserId,
  updateCustomer,
} from "@/server/services/customer.service";

export const runtime = "nodejs";

async function getCustomer() {
  const user = await getCurrentUser();
  if (!user) {
    return { response: Response.json({ success: false, message: "Authentication is required" }, { status: 401 }) };
  }
  if (user.role !== "customer") {
    return { response: Response.json({ success: false, message: "Customer access is required" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  try {
    const result = await getCustomer();
    if (result.response) return result.response;
    const customer = await findCustomerByUserId(pool, result.user.id);
    if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
    return Response.json({ success: true, customer: customerForViewer(customer, "customer") });
  } catch (error) {
    console.error("Unable to load customer profile", error);
    return Response.json({ success: false, message: "Unable to load customer profile" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const result = await getCustomer();
    if (result.response) return result.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, message: "Invalid customer information" }, { status: 400 });
    }
    const parsed = customerSelfUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "Invalid customer information",
          errors: formatValidationErrors(parsed.error),
        },
        { status: 400 },
      );
    }

    const current = await findCustomerByUserId(pool, result.user.id);
    if (!current) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
    const { currentPassword, ...profile } = parsed.data;
    // A stolen session must not be able to move the account to a new email.
    if (profile.email.trim().toLowerCase() !== current.email.toLowerCase()) {
      if (!currentPassword)
        return Response.json({ success: false, message: "Enter your current password to change your email" }, { status: 400 });
      const stored = await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id=$1 AND deleted_at IS NULL", [result.user.id]);
      if (!stored.rows[0] || !(await verifyPassword(currentPassword, stored.rows[0].password_hash)))
        return Response.json({ success: false, message: "Current password is incorrect" }, { status: 403 });
    }
    const customer = await updateCustomer(pool, current.id, profile);
    if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
    // A new address has to be verified again.
    if (customer.email.toLowerCase() !== current.email.toLowerCase()) {
      await resetEmailVerification(pool, result.user.id);
      await issueVerificationCode(pool, result.user.id, { force: true })
        .catch((error) => console.error("Unable to send verification code", error));
    }
    return Response.json({ success: true, customer: customerForViewer(customer, "customer") });
  } catch (error) {
    if (error instanceof CustomerEmailTakenError)
      return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Unable to update customer profile", error);
    return Response.json({ success: false, message: "Unable to update customer profile" }, { status: 500 });
  }
}
