import { branchErrorResponse, resolveOperationalBranch, branchIdParam } from "@/server/auth/branch-access";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { listLowStockAlerts } from "@/server/services/inventory-alert.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  try {
    return Response.json({ success: true, alerts: await listLowStockAlerts(pool, user.id, await resolveOperationalBranch(pool, user, branchIdParam(request))) });
  } catch (error) {
    const branchError = branchErrorResponse(error); if (branchError) return branchError;
    console.error("Unable to load inventory alerts", error);
    return Response.json({ success: false, message: "Unable to load inventory alerts" }, { status: 500 });
  }
}

