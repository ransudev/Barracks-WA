import { withInventoryOwner, branchErrorResponse } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { inventoryMovementSchema } from "@/server/schemas/sprint2.schema";
import { applyInventoryMovement, listInventoryMovements } from "@/server/services/inventory-movement.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser(); if (user instanceof Response) return user;
  const id = parseRouteId((await params).id); if (!id) return Response.json({success:false,message:"Invalid inventory item id"},{status:400});
  try { return Response.json({success:true,movements:await withInventoryOwner(pool, user, request, "inventory_items", id, (client, branchId) => listInventoryMovements(client,id,branchId))}); }
  catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError; return Response.json({success:false,message:"Unable to load stock history"},{status:500}); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManagementUser(); if (staff instanceof Response) return staff;
  const id = parseRouteId((await params).id); if (!id) return Response.json({success:false,message:"Invalid inventory item id"},{status:400});
  let body: unknown; try { body = await request.json(); } catch { return Response.json({success:false,message:"Invalid stock operation"},{status:400}); }
  const parsed = inventoryMovementSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({success:false,message:"Invalid stock operation",errors:parsed.error.flatten().fieldErrors},{status:400});
  }

  try {
    const movement = await withInventoryOwner(pool, staff, request, "inventory_items", id, (client) => applyInventoryMovement(client,id,staff.id,parsed.data));
    return Response.json({success:true,movement},{status:201});
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    const code = error instanceof Error ? error.message : "";
    const message = code === "NEGATIVE_STOCK"
      ? "Stock cannot become negative"
      : code === "INVENTORY_NOT_FOUND"
        ? "Inventory item not found"
        : code === "CUSTOMER_PURCHASE_REQUIRES_PRODUCT"
          ? "Customer purchases can only be recorded for products or supplies"
        : code === "STAFF_USAGE_REQUIRES_SUPPLY"
            ? "Barber usage can only be recorded for products or supplies"
            : "Unable to record stock operation";
    return Response.json({success:false,message},{status:400});
  }
}
