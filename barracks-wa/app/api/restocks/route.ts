import { branchErrorResponse, resolveOperationalBranch, branchIdParam } from "@/server/auth/branch-access";
import { requireManagementUser, requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { restockCreateSchema } from "@/server/schemas/sprint2.schema";
import { createRestockRequest, listRestockRequests } from "@/server/services/restock.service";
import { supplierIdForUser } from "@/server/services/supplier.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireRolesUser(["administrator", "manager", "supplier"]);
  if (user instanceof Response) return user;
  try {
    const supplierId = user.role === "supplier" ? await supplierIdForUser(pool, user.id) : undefined;
    if (user.role === "supplier" && !supplierId) {
      return Response.json({ success: false, message: "Supplier account is inactive or not linked" }, { status: 403 });
    }
    return Response.json({ success: true, restocks: await listRestockRequests(pool, supplierId ?? undefined, undefined, user.role === "supplier" ? undefined : await resolveOperationalBranch(pool, user, branchIdParam(request))) });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    console.error("Unable to list restock requests", error);
    return Response.json({ success: false, message: "Unable to load restock requests" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: "Invalid restock request" }, { status: 400 });
  }
  const parsed = restockCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ success: false, message: "Invalid restock request", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const restock = await createRestockRequest(pool, user.id, parsed.data, await resolveOperationalBranch(pool, user, branchIdParam(request)));
    return Response.json({ success: true, restock }, { status: 201 });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
      const message = error instanceof Error && error.message === "SUPPLIER_UNAVAILABLE"
      ? "Supplier is inactive or unavailable"
      : error instanceof Error && error.message === "ITEM_NOT_LINKED_TO_SUPPLIER"
        ? "Every restock item must belong to the selected supplier"
      : error instanceof Error && error.message === "ITEM_NOT_IN_BRANCH"
          ? "Every restock item must belong to the selected branch"
        : error instanceof Error && error.message === "DUPLICATE_RESTOCK_ITEM"
          ? "An item can only appear once per restock request"
        : "Unable to create restock request";
    return Response.json({ success: false, message }, { status: 400 });
  }
}
