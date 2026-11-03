import { z } from "zod";
import { resolveOperationalBranch } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { branchApiError } from "@/server/services/branch-api";
import { setSupplierItems } from "@/server/services/supplier.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";
const schema = z.object({ inventoryItemIds: z.array(z.number().int().positive()).max(500) }).strict();

// Assign the inventory items this supplier provides in the selected branch.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id); if (!id) return Response.json({ success: false, message: "Invalid supplier id" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid item selection" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid item selection" }, { status: 400 });
  try {
    const branchId = await resolveOperationalBranch(pool, actor, new URL(request.url).searchParams.get("branchId"));
    await setSupplierItems(pool, id, branchId, [...new Set(parsed.data.inventoryItemIds)]);
    return Response.json({ success: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SUPPLIER_UNAVAILABLE") return Response.json({ success: false, message: "Supplier is inactive or unavailable" }, { status: 400 });
    if (code === "ITEM_NOT_IN_BRANCH") return Response.json({ success: false, message: "Some items are not in this branch" }, { status: 400 });
    if (code === "ITEM_HAS_OPEN_RESTOCK") return Response.json({ success: false, message: `${(error as Error & { itemName?: string }).itemName ?? "An item"} has an open restock request. Receive or cancel it before changing its supplier.` }, { status: 409 });
    return branchApiError(error);
  }
}
