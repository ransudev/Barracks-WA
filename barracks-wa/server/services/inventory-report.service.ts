import type { Pool } from "pg";
import { requireManagementReport, resolveReportBranches, type BranchActor } from "@/server/auth/branch-access";

function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }
function manilaBoundary(date: Date): Date { return new Date(`${dateOnly(date)}T00:00:00+08:00`); }

export async function getInventoryReport(db: Pool, actor: BranchActor, from: Date, to: Date, rawBranch: string | null = null) {
  requireManagementReport(actor);
  const branchIds = await resolveReportBranches(db, actor, rawBranch);
  const toExclusive = new Date(to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const previousFrom = new Date(from.getTime() - (toExclusive.getTime() - from.getTime()));
  const previousTo = new Date(from);
  const [valuation, supplierSpending, movements, usageSummary] = await Promise.all([
    db.query(`
      SELECT
        COALESCE(SUM(quantity * unit_cost), 0) AS total_value,
        COUNT(*) FILTER (WHERE status='active') AS active_items,
        COUNT(*) FILTER (WHERE status='active' AND quantity <= minimum_stock) AS low_stock_items
      FROM inventory_items WHERE branch_id=ANY($1::integer[])
    `, [branchIds]),
    db.query(`
      SELECT s.id AS supplier_id, s.company_name AS supplier_name,
        CASE WHEN COUNT(*) FILTER (WHERE ri.delivered_quantity > 0 AND ri.unit_cost IS NULL) > 0 THEN NULL
          ELSE COALESCE(SUM(ri.delivered_quantity * ri.unit_cost), 0) END AS total_spend,
        COUNT(DISTINCT r.id) AS received_deliveries
      FROM suppliers s
      JOIN restock_requests r ON r.supplier_id=s.id
        AND r.branch_id=ANY($3::integer[])
        AND r.status='Received'
        AND r.received_at >= $1
        AND r.received_at < $2
      LEFT JOIN restock_request_items ri ON ri.restock_request_id=r.id
      GROUP BY s.id, s.company_name
      ORDER BY total_spend DESC, s.company_name ASC
    `, [manilaBoundary(from), manilaBoundary(toExclusive), branchIds]),
    db.query(`
      SELECT m.id, m.movement_type, m.quantity, m.previous_stock, m.new_stock, m.unit_cost,
        m.reference, m.notes, m.created_at, i.name AS item_name, m.branch,
        s.company_name AS supplier_name,
        u.first_name || ' ' || u.last_name AS created_by_name
      FROM inventory_movements m
      JOIN inventory_items i ON i.id=m.inventory_item_id
      JOIN users u ON u.id=m.created_by
      LEFT JOIN suppliers s ON s.id=m.supplier_id
      WHERE m.created_at >= $1 AND m.created_at < $2 AND m.branch_id=ANY($3::integer[])
      ORDER BY m.created_at DESC
      LIMIT 250
    `, [manilaBoundary(from), manilaBoundary(toExclusive), branchIds]),
    db.query(`
      WITH report_items AS (
        SELECT id AS item_id,branch_id FROM inventory_items
        WHERE status='active' AND branch_id=ANY($5::integer[])
        UNION
        SELECT inventory_item_id,branch_id FROM inventory_movements
        WHERE branch_id=ANY($5::integer[]) AND created_at >= $3 AND created_at < $2
      )
      SELECT
        i.id AS item_id,
        i.name AS item_name,
        scope.branch_id,
        COALESCE(MAX(m.branch), MAX(i.branch) FILTER (WHERE i.branch_id=scope.branch_id)) AS branch,
        CASE WHEN i.branch_id=scope.branch_id THEN i.quantity ELSE NULL END AS current_quantity,
        CASE WHEN i.branch_id=scope.branch_id THEN i.minimum_stock ELSE NULL END AS minimum_stock,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type IN ('RECEIVE','RETURN') THEN m.quantity ELSE 0 END),0) AS received,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type IN ('USE','STAFF_USAGE') THEN m.quantity ELSE 0 END),0) AS used,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type='CUSTOMER_PURCHASE' THEN m.quantity ELSE 0 END),0) AS sold,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type IN ('DAMAGE','DISCARD') THEN m.quantity ELSE 0 END),0) AS wasted,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type='ADJUSTMENT' THEN m.quantity ELSE 0 END),0) AS adjusted,
        COALESCE(SUM(CASE WHEN m.created_at >= $1 AND m.created_at < $2 AND m.movement_type IN ('USE','STAFF_USAGE','CUSTOMER_PURCHASE','DAMAGE','DISCARD') THEN m.quantity ELSE 0 END),0) AS current_activity,
        COALESCE(SUM(CASE WHEN m.created_at >= $3 AND m.created_at < $4 AND m.movement_type IN ('USE','STAFF_USAGE','CUSTOMER_PURCHASE','DAMAGE','DISCARD') THEN m.quantity ELSE 0 END),0) AS previous_activity
      FROM report_items scope
      JOIN inventory_items i ON i.id=scope.item_id
      LEFT JOIN inventory_movements m ON m.inventory_item_id=scope.item_id AND m.branch_id=scope.branch_id
        AND m.created_at >= $3 AND m.created_at < $2
      GROUP BY i.id,scope.branch_id
      ORDER BY current_activity DESC, i.name ASC
    `, [manilaBoundary(from), manilaBoundary(toExclusive), manilaBoundary(previousFrom), manilaBoundary(previousTo), branchIds]),
  ]);

  const totals = valuation.rows[0] ?? { total_value: 0, active_items: 0, low_stock_items: 0 };
  return {
    success: true,
    range: {
      from: dateOnly(from),
      to: dateOnly(to),
      previousFrom: dateOnly(previousFrom),
      previousTo: dateOnly(new Date(previousTo.getTime() - 86400000)),
    },
    valuation: {
      totalValue: Number(totals.total_value ?? 0),
      activeItems: Number(totals.active_items ?? 0),
      lowStockItems: Number(totals.low_stock_items ?? 0),
    },
    supplierSpending: supplierSpending.rows.map((row) => ({
      supplierId: Number(row.supplier_id),
      supplierName: row.supplier_name,
      totalSpend: row.total_spend === null ? null : Number(row.total_spend ?? 0),
      receivedDeliveries: Number(row.received_deliveries ?? 0),
    })),
    usageSummary: usageSummary.rows.map((row) => ({
      itemId: Number(row.item_id),
      branchId: Number(row.branch_id),
      itemName: row.item_name,
      branch: row.branch,
      currentQuantity: row.current_quantity === null ? null : Number(row.current_quantity),
      minimumStock: row.minimum_stock === null ? null : Number(row.minimum_stock),
      received: Number(row.received),
      used: Number(row.used),
      sold: Number(row.sold),
      wasted: Number(row.wasted),
      adjusted: Number(row.adjusted),
      currentActivity: Number(row.current_activity),
      previousActivity: Number(row.previous_activity),
    })),
    movements: movements.rows,
  };
}
