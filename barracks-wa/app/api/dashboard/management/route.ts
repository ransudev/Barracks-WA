import { requireManagementUser } from "@/server/auth/require-role";
import { resolveReportBranches } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { pool } from "@/server/db/pool";
import type { ManagementDashboardData } from "@/app/types/dashboard";
import { getDashboardReportForBranches } from "@/server/services/dashboard-report.service";
import { getRevenueReportForBranches } from "@/server/services/revenue-report.service";
import { dateInputValue } from "@/app/utils/format";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireManagementUser();
  if (actor instanceof Response) return actor;
  try {
    const rawBranch = new URL(request.url).searchParams.get("branchId");
    const branchIds = await resolveReportBranches(pool, actor, rawBranch);
    const to = dateInputValue();
    const first = new Date(`${to}T12:00:00Z`); first.setUTCDate(first.getUTCDate() - 6);
    const from = first.toISOString().slice(0, 10);
    const [summary, financial, actionable, scope] = await Promise.all([
      getDashboardReportForBranches(pool, branchIds),
      getRevenueReportForBranches(pool, { from, to }, branchIds).then((sales) => ({ sales, salesError: "" })).catch((error: unknown) => { console.error("Dashboard sales unavailable", error); return { sales: null, salesError: "Sales summary unavailable. Refresh to retry." }; }),
      pool.query(`SELECT r.id,r.branch_id AS "branchId",r.branch,r.status,s.company_name AS "supplierName"
        FROM restock_requests r JOIN suppliers s ON s.id=r.supplier_id
        WHERE r.branch_id=ANY($1::integer[]) AND r.status IN ('Shipped','Delivered') ORDER BY r.id DESC`, [branchIds]),
      pool.query<{ name: string }>("SELECT name FROM branches WHERE id=ANY($1::integer[]) ORDER BY name", [branchIds]),
    ]);
    const dashboard: ManagementDashboardData = {
      inventoryValue: summary.inventoryValue, openRestocks: summary.openRestocks,
      todayBookings: summary.todayBookings, upcomingBookings: summary.upcomingBookings, pendingBookings: summary.pendingBookings,
      activeBarbers: summary.activeBarbers, customerCount: summary.customers,
      lowStock: summary.attentionItems, recentDeliveries: summary.recentDeliveries,
      sales: financial.sales, salesError: financial.salesError,
      scope: scope.rows.map((row) => row.name).join(", ") || "No accessible branches", generatedAt: new Date().toISOString(),
      actionableRestocks: actionable.rows,
    };
    return Response.json({ success: true, dashboard }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return branchApiError(error); }
}