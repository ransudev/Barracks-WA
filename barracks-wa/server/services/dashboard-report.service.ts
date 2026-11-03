import type { Pool } from "pg";
import { requireManagementReport, resolveReportBranches, type BranchActor } from "@/server/auth/branch-access";

export async function getDashboardReport(db: Pool, actor: BranchActor, rawBranch: string | null = null) {
  requireManagementReport(actor);
  const branchIds = await resolveReportBranches(db, actor, rawBranch);
  return getDashboardReportForBranches(db, branchIds);
}

// Internal query helper: callers must resolve authorized branch IDs first.
export async function getDashboardReportForBranches(db: Pool, branchIds: number[]) {
  const [metrics, attention, deliveries] = await Promise.all([
    db.query(`SELECT
      (SELECT COALESCE(SUM(quantity * unit_cost),0) FROM inventory_items WHERE branch_id=ANY($1::integer[])) AS inventory_value,
      (SELECT COUNT(*) FROM inventory_items WHERE branch_id=ANY($1::integer[]) AND status='active' AND quantity<=minimum_stock) AS low_stock,
      (SELECT COUNT(*) FROM restock_requests WHERE branch_id=ANY($1::integer[]) AND status NOT IN ('Received','Cancelled')) AS open_restocks,
      (SELECT COUNT(*) FROM bookings WHERE branch_id=ANY($1::integer[]) AND booking_date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND status NOT IN ('cancelled','rejected')) AS today_bookings,
      (SELECT COUNT(*) FROM bookings WHERE branch_id=ANY($1::integer[]) AND booking_date>=(NOW() AT TIME ZONE 'Asia/Manila')::date AND status='confirmed') AS upcoming_bookings,
      (SELECT COUNT(*) FROM bookings WHERE branch_id=ANY($1::integer[]) AND status='pending') AS pending_bookings,
      (SELECT COUNT(*) FROM barbers WHERE branch_id=ANY($1::integer[]) AND status<>'unavailable') AS active_barbers,
      (SELECT COUNT(*) FROM customers c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN roles r ON r.id=u.role_id
        WHERE (c.user_id IS NULL OR (u.deleted_at IS NULL AND r.name='customer')) AND
        (EXISTS(SELECT 1 FROM bookings b WHERE b.customer_id=c.id AND b.branch_id=ANY($1::integer[])) OR
         EXISTS(SELECT 1 FROM queue_entries q WHERE q.customer_id=c.id AND q.branch_id=ANY($1::integer[])))) AS customers
    `, [branchIds]),
    db.query(`SELECT i.id,i.name,i.branch,i.branch_id AS "branchId",i.category,i.quantity,i.minimum_stock AS "minimumStock",i.unit,s.company_name AS "supplierName"
      FROM inventory_items i LEFT JOIN suppliers s ON s.id=i.supplier_id
      WHERE i.branch_id=ANY($1::integer[]) AND i.status='active' AND i.quantity<=i.minimum_stock
      ORDER BY i.name,i.id`, [branchIds]),
    db.query(`SELECT r.id,s.company_name AS supplier_name,r.reference,r.received_at
      FROM restock_requests r JOIN suppliers s ON s.id=r.supplier_id
      WHERE r.branch_id=ANY($1::integer[]) AND r.status='Received'
      ORDER BY r.received_at DESC,r.id DESC LIMIT 5`, [branchIds]),
  ]);
  const row = metrics.rows[0];
  return {
    inventoryValue: Number(row.inventory_value), lowStock: Number(row.low_stock), openRestocks: Number(row.open_restocks),
    todayBookings: Number(row.today_bookings), upcomingBookings: Number(row.upcoming_bookings), pendingBookings: Number(row.pending_bookings), activeBarbers: Number(row.active_barbers), customers: Number(row.customers),
    attentionItems: attention.rows as Array<{ id: number; name: string; branch: string; branchId: number; category: string; quantity: number; minimumStock: number; unit: string; supplierName: string | null }>,
    recentDeliveries: deliveries.rows as Array<{ id: number; supplier_name: string; reference: string | null; received_at: string }>,
  };
}
export type DashboardReport = Awaited<ReturnType<typeof getDashboardReport>>;
