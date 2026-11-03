import { withInventoryOwner, branchErrorResponse } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { acknowledgeLowStockAlert } from "@/server/services/inventory-alert.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid inventory item id" }, { status: 400 });
  try {
    const alert = await withInventoryOwner(pool, user, request, "inventory_items", id, (client) => acknowledgeLowStockAlert(client, id, user.id));
    return Response.json({ success: true, alert });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    const code = error instanceof Error ? error.message : "";
    if (code === "INVENTORY_NOT_FOUND") return Response.json({ success: false, message: "Inventory item not found" }, { status: 404 });
    if (code === "ALERT_NOT_ACTIVE") return Response.json({ success: false, message: "This stock alert is no longer active" }, { status: 409 });
    console.error("Unable to acknowledge inventory alert", error);
    return Response.json({ success: false, message: "Unable to acknowledge inventory alert" }, { status: 500 });
  }
}

