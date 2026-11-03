import { withInventoryOwner, branchErrorResponse } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { markRestockDelivered } from "@/server/services/restock.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid restock id" }, { status: 400 });

  try {
    return Response.json({ success: true, restock: await withInventoryOwner(pool, user, request, "restock_requests", id, (client) => markRestockDelivered(client, id)) });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    const message = error instanceof Error && error.message === "INVALID_STATUS_TRANSITION"
      ? "Only open restock requests can be marked as arrived"
      : "Unable to mark delivery as delivered";
    return Response.json({ success: false, message }, { status: 400 });
  }
}
