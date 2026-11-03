import { branchErrorResponse, resolveOperationalBranch, branchIdParam } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { inventoryCreateSchema } from "@/server/schemas/sprint2.schema";
import { createInventoryItem, listInventory } from "@/server/services/inventory.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const staff = await requireManagementUser();
  if (staff instanceof Response) return staff;
  try {
    const branchId = await resolveOperationalBranch(pool, staff, branchIdParam(request));
    return Response.json({ success: true, items: await listInventory(pool, branchId) });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    console.error("Unable to list inventory", error);
    return Response.json({ success: false, message: "Unable to load inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staff = await requireManagementUser();
  if (staff instanceof Response) return staff;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: "Invalid inventory information" }, { status: 400 });
  }
  const parsed = inventoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ success: false, message: "Invalid inventory information", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    return Response.json({ success: true, item: await createInventoryItem(pool, parsed.data, await resolveOperationalBranch(pool, staff, branchIdParam(request))) }, { status: 201 });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    if (error instanceof Error && error.message === "SUPPLIER_UNAVAILABLE") {
      return Response.json({ success: false, message: "Supplier is inactive or unavailable" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "DUPLICATE_SKU") {
      return Response.json({ success: false, message: "Another inventory item already uses this SKU" }, { status: 409 });
    }
    console.error("Unable to create inventory item", error);
    return Response.json({ success: false, message: "Unable to create inventory item" }, { status: 500 });
  }
}
