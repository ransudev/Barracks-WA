import { withInventoryOwner, branchErrorResponse } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { inventoryMetadataSchema } from "@/server/schemas/sprint2.schema";
import { deleteInventory, findInventoryById, updateInventoryMetadata } from "@/server/services/inventory.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManagementUser();
  if (staff instanceof Response) return staff;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid inventory item id" }, { status: 400 });
  try {
    const item = await withInventoryOwner(pool, staff, request, "inventory_items", id, (client) => findInventoryById(client, id));
    if (!item) return Response.json({ success: false, message: "Inventory item not found" }, { status: 404 });
    return Response.json({ success: true, item });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    console.error("Unable to load inventory item", error);
    return Response.json({ success: false, message: "Unable to load inventory item" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManagementUser();
  if (staff instanceof Response) return staff;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid inventory item id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: "Invalid inventory information" }, { status: 400 });
  }
  const parsed = inventoryMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ success: false, message: "Invalid inventory information", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const item = await withInventoryOwner(pool, staff, request, "inventory_items", id, (client) => updateInventoryMetadata(client, id, staff.id, parsed.data));
    if (!item) return Response.json({ success: false, message: "Inventory item not found" }, { status: 404 });
    return Response.json({ success: true, item });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    if (error instanceof Error && error.message === "SUPPLIER_UNAVAILABLE") {
      return Response.json({ success: false, message: "Supplier is inactive or unavailable" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "DUPLICATE_SKU") {
      return Response.json({ success: false, message: "Another inventory item already uses this SKU" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "ITEM_HAS_OPEN_RESTOCK") {
      return Response.json({ success: false, message: "Receive or cancel this item's open restock requests before changing its supplier" }, { status: 409 });
    }
    console.error("Unable to update inventory item", error);
    return Response.json({ success: false, message: "Unable to update inventory item" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManagementUser();
  if (staff instanceof Response) return staff;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid inventory item id" }, { status: 400 });
  try {
    const outcome = await withInventoryOwner(pool, staff, request, "inventory_items", id, (client) => deleteInventory(client, id));
    if (!outcome) return Response.json({ success: false, message: "Inventory item not found" }, { status: 404 });
    return Response.json({ success: true, outcome, message: outcome === "deleted" ? "Inventory item deleted" : "Inventory item archived" });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    console.error("Unable to delete inventory item", error);
    return Response.json({ success: false, message: "Unable to deactivate inventory item" }, { status: 500 });
  }
}
