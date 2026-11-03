import { visitBranch, resolveOperationalBranch } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { requireRolesUser, requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { hoursSchema } from "@/server/schemas/schedule.schema";
import { listShopHours, saveShopHours, ShopHoursConfigurationError } from "@/server/services/schedule.service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRolesUser(["customer", "front_desk", "manager", "administrator"]);
  if (actor instanceof Response) return actor;
  try {
    const branchId = await visitBranch(pool, actor, request);
    return Response.json({ success: true, hours: await listShopHours(pool, branchId), timezone: "Asia/Manila" });
  }
  catch (error) { if (error instanceof ShopHoursConfigurationError) return Response.json({ success: false, message: error.message }, { status: 409 }); return branchApiError(error); }
}
export async function PUT(request: Request) {
  const actor = await requireManagementUser();
  if (actor instanceof Response) return actor;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid hours" }, { status: 400 }); }
  const parsed = hoursSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid hours", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  try { return Response.json({ success: true, hours: await saveShopHours(pool, parsed.data, await resolveOperationalBranch(pool, actor, new URL(request.url).searchParams.get("branchId"))) }); }
  catch (error) { if (error instanceof ShopHoursConfigurationError) return Response.json({ success: false, message: error.message }, { status: 409 }); return branchApiError(error); }
}
