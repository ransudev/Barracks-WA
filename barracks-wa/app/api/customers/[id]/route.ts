import { requireAdministrator, requireStaffUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import {
  customerProfileSchema,
  customerStaffProfileSchema,
  walkinCustomerProfileSchema,
  walkinCustomerStaffProfileSchema,
  formatValidationErrors,
} from "@/server/schemas/sprint.schema";
import {
  canIssueLoyaltyCards,
  CustomerEmailTakenError,
  customerForViewer,
  deleteCustomer,
  findCustomerById,
  LoyaltyCardForbiddenError,
  updateCustomer,
} from "@/server/services/customer.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffUser();
  if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid customer id" }, { status: 400 });

  try {
    const customer = await findCustomerById(pool, id);
    if (!customer) return Response.json({ success: false, message: "Customer not found" }, { status: 404 });
    return Response.json({ success: true, customer: customerForViewer(customer, actor.role) });
  } catch (error) {
    console.error("Unable to load customer", error);
    return Response.json({ success: false, message: "Unable to load customer" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorizationResult = await requireStaffUser();
  if (authorizationResult instanceof Response) return authorizationResult;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid customer id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "Invalid customer information" }, { status: 400 });
  }
  if (!canIssueLoyaltyCards(authorizationResult.role) && typeof body === "object" && body !== null && "loyaltyCardIssued" in body) {
    return Response.json({ success: false, message: "Only a Manager can record loyalty cards" }, { status: 403 });
  }
  try {
    const current = await findCustomerById(pool, id);
    if (!current) return Response.json({ success: false, message: "Customer not found" }, { status: 404 });
    const profileSchema = current.userId === null ? walkinCustomerProfileSchema : customerProfileSchema;
    const staffProfileSchema = current.userId === null ? walkinCustomerStaffProfileSchema : customerStaffProfileSchema;
    const parsed = (canIssueLoyaltyCards(authorizationResult.role) ? profileSchema : staffProfileSchema).safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, message: "Invalid customer information", errors: formatValidationErrors(parsed.error) },
        { status: 400 },
      );
    }

    const customer = await updateCustomer(pool, id, parsed.data, authorizationResult);
    if (!customer) return Response.json({ success: false, message: "Customer not found" }, { status: 404 });
    return Response.json({ success: true, customer: customerForViewer(customer, authorizationResult.role) });
  } catch (error) {
    if (error instanceof LoyaltyCardForbiddenError)
      return Response.json({ success: false, message: error.message }, { status: 403 });
    if (error instanceof CustomerEmailTakenError)
      return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Unable to update customer", error);
    return Response.json({ success: false, message: "Unable to update customer" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorizationResponse = await requireAdministrator();
  if (authorizationResponse) return authorizationResponse;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid customer id" }, { status: 400 });

  try {
    const result = await deleteCustomer(pool, id);
    if (result === "active_bookings") {
      return Response.json(
        { success: false, message: "Customer cannot be deactivated while active appointments exist." },
        { status: 409 },
      );
    }
    if (result === "not_found") {
      return Response.json({ success: false, message: "Customer not found" }, { status: 404 });
    }
    return Response.json({ success: true, message: "Customer deactivated" });
  } catch (error) {
    console.error("Unable to delete customer", error);
    return Response.json({ success: false, message: "Unable to delete customer" }, { status: 500 });
  }
}
