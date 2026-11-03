import { listAccessibleBranches } from "@/server/auth/branch-access";
import { requireAdministrator, requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { supplierSchema } from "@/server/schemas/sprint2.schema";
import { findSupplier, getSupplierProfile, updateSupplier } from "@/server/services/supplier.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser(); if (user instanceof Response) return user;
  const id = parseRouteId((await params).id); if (!id) return Response.json({ success:false,message:"Invalid supplier id" },{status:400});
  const profile = await getSupplierProfile(pool, id, (await listAccessibleBranches(pool, user)).map((branch) => branch.id));
  return profile ? Response.json({ success:true, profile }) : Response.json({ success:false,message:"Supplier not found" },{status:404});
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id); if (!id) return Response.json({ success:false,message:"Invalid supplier id" },{status:400});
  let body: unknown; try { body = await request.json(); } catch { return Response.json({success:false,message:"Invalid supplier information"},{status:400}); }
  const parsed = supplierSchema.safeParse(body);
  if (!parsed.success) return Response.json({success:false,message:"Invalid supplier information",errors:parsed.error.flatten().fieldErrors},{status:400});
  try {
    const supplier = await updateSupplier(pool,id,parsed.data,actor.role === "administrator");
    if (!supplier && actor.role === "manager" && parsed.data.status === "inactive") {
      const existing = await findSupplier(pool, id);
      if (existing?.status === "active") return Response.json({ success: false, message: "Administrator access is required to deactivate a supplier" }, { status: 403 });
    }
    return supplier ? Response.json({success:true,supplier}) : Response.json({success:false,message:"Supplier not found"},{status:404});
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_SUPPLIER_NAME") {
      return Response.json({ success: false, message: "An active supplier with this company name already exists" }, { status: 409 });
    }
    console.error("Unable to update supplier", error);
    return Response.json({ success:false, message:"Unable to update supplier" }, { status:500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdministrator(); if (denied) return denied;
  const id = parseRouteId((await params).id); if (!id) return Response.json({ success:false,message:"Invalid supplier id" },{status:400});
  if (!(await findSupplier(pool,id))) return Response.json({success:false,message:"Supplier not found"},{status:404});
  await pool.query("UPDATE suppliers SET status='inactive',updated_at=NOW() WHERE id=$1",[id]);
  return Response.json({success:true,message:"Supplier deactivated"});
}
