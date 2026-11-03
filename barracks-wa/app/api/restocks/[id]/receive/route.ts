import { withInventoryOwner, branchErrorResponse } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { receiveRestockSchema } from "@/server/schemas/sprint2.schema";
import { receiveRestock } from "@/server/services/restock.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser(); if (user instanceof Response) return user;
  const id = parseRouteId((await params).id); if (!id) return Response.json({success:false,message:"Invalid restock id"},{status:400});
  let body: unknown; try { body = await request.json(); } catch { return Response.json({success:false,message:"Invalid receiving information"},{status:400}); }
  const parsed = receiveRestockSchema.safeParse(body); if (!parsed.success) return Response.json({success:false,message:"Invalid receiving information"},{status:400});
  try {
    return Response.json({success:true,restock:await withInventoryOwner(pool, user, request, "restock_requests", id, (client) => receiveRestock(client,id,user.id,parsed.data))});
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    const code = error instanceof Error ? error.message : "";
    const message = code === "ALREADY_RECEIVED" ? "This delivery has already been received"
      : code === "NOT_READY_TO_RECEIVE" ? "The restock request is not ready to receive"
      : code === "RESTOCK_NOT_FOUND" ? "Restock request not found"
      : code === "RESTOCK_LINES_INCOMPLETE" ? "Provide each restock line exactly once"
      : code === "DELIVERED_QUANTITY_EXCEEDS_REQUESTED" ? "Delivered quantity cannot exceed the requested quantity"
      : "Unable to receive delivery";
    return Response.json({success:false,message},{status:400});
  }
}
