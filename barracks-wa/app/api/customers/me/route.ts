import { getCurrentUser } from "@/server/auth/session";
import { pool } from "@/server/db/pool";
import {
  customerSelfProfileSchema,
  formatValidationErrors,
} from "@/server/schemas/sprint.schema";
import {
  CustomerEmailTakenError,
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
    return Response.json({ success: true, customer });
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
    const parsed = customerSelfProfileSchema.safeParse(body);
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
    const customer = await updateCustomer(pool, current.id, parsed.data);
    if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
    return Response.json({ success: true, customer });
  } catch (error) {
    if (error instanceof CustomerEmailTakenError)
      return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Unable to update customer profile", error);
    return Response.json({ success: false, message: "Unable to update customer profile" }, { status: 500 });
  }
}
