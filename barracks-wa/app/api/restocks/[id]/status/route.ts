import { requireSupplierUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { restockStatusSchema } from "@/server/schemas/sprint2.schema";
import { updateSupplierRestockStatus } from "@/server/services/restock.service";
import { supplierIdForUser } from "@/server/services/supplier.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSupplierUser(); if (user instanceof Response) return user;
  const id = parseRouteId((await params).id); if (!id) return Response.json({success:false,message:"Invalid restock id"},{status:400});
  const supplierId = await supplierIdForUser(pool,user.id); if (!supplierId) return Response.json({success:false,message:"Supplier account is not linked"},{status:403});
  let body: unknown; try { body = await request.json(); } catch { return Response.json({success:false,message:"Invalid status"},{status:400}); }
  const parsed = restockStatusSchema.safeParse(body); if (!parsed.success) return Response.json({success:false,message:"Invalid status"},{status:400});
  try {
    const restock = await updateSupplierRestockStatus(pool,id,supplierId,parsed.data.status);
    return Response.json({success:true,restock});
  } catch (error) {
    const message = error instanceof Error && error.message === "INVALID_STATUS_TRANSITION" ? "Invalid restock status transition" : "Restock request not found";
    return Response.json({success:false,message},{status:400});
  }
}
