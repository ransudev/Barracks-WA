import type { Pool } from "pg";
import { requireManagementReport, resolveReportBranches, type BranchActor } from "@/server/auth/branch-access";

export type RevenueRange = { from: string; to: string };
export type RevenueTotals = { grossSales: number; refundedAmount: number; voidedAmount: number; reversedAmount: number; netRevenue: number; transactionCount: number };
export type RevenueGroup = RevenueTotals & { label: string };
export type RevenueReport = {
  range: RevenueRange;
  summary: RevenueTotals;
  dailySales: RevenueGroup[];
  byService: RevenueGroup[];
  byBarber: RevenueGroup[];
  byPaymentMethod: RevenueGroup[];
};

type EventRow = {
  day: string; service_name: string; barber_name: string; payment_method: string;
  event_type: "sale" | "refund" | "void"; amount: string; transaction_count: string;
};

function emptyCents() {
  return { grossSales: 0, refundedAmount: 0, voidedAmount: 0, reversedAmount: 0, netRevenue: 0, transactionCount: 0 };
}

type CentTotals = ReturnType<typeof emptyCents>;

function addEvent(totals: CentTotals, row: EventRow) {
  const cents = Math.round(Number(row.amount) * 100);
  if (row.event_type === "sale") {
    totals.grossSales += cents;
    totals.transactionCount += Number(row.transaction_count);
  } else {
    if (row.event_type === "refund") totals.refundedAmount += cents;
    else totals.voidedAmount += cents;
    totals.reversedAmount += cents;
  }
  totals.netRevenue = totals.grossSales - totals.reversedAmount;
}

function money(totals: CentTotals): RevenueTotals {
  return { grossSales: totals.grossSales / 100, refundedAmount: totals.refundedAmount / 100,
    voidedAmount: totals.voidedAmount / 100, reversedAmount: totals.reversedAmount / 100,
    netRevenue: totals.netRevenue / 100, transactionCount: totals.transactionCount };
}

export function summarizeRevenueEvents(range: RevenueRange, rows: EventRow[]): RevenueReport {
  const summary = emptyCents();
  const groups = [new Map<string, CentTotals>(), new Map<string, CentTotals>(),
    new Map<string, CentTotals>(), new Map<string, CentTotals>()];
  for (const row of rows) {
    addEvent(summary, row);
    [row.day, row.service_name, row.barber_name, row.payment_method].forEach((key, index) => {
      let totals = groups[index].get(key);
      if (!totals) { totals = emptyCents(); groups[index].set(key, totals); }
      addEvent(totals, row);
    });
  }
  const list = (group: Map<string, CentTotals>, daily = false): RevenueGroup[] =>
    [...group].map(([label, totals]) => ({ label, ...money(totals) }))
      .sort((a, b) => daily ? a.label.localeCompare(b.label)
        : b.netRevenue - a.netRevenue || a.label.localeCompare(b.label));
  return { range, summary: money(summary), dailySales: list(groups[0], true),
    byService: list(groups[1]), byBarber: list(groups[2]), byPaymentMethod: list(groups[3]) };
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function getRevenueReport(db: Pool, range: RevenueRange, actor: BranchActor, rawBranch: string | null = null): Promise<RevenueReport> {
  requireManagementReport(actor);
  const branchIds = await resolveReportBranches(db, actor, rawBranch);
  return getRevenueReportForBranches(db, range, branchIds);
}

// Internal query helper: callers must resolve authorized branch IDs first.
export async function getRevenueReportForBranches(db: Pool, range: RevenueRange, branchIds: number[]): Promise<RevenueReport> {
  const start = `${range.from}T00:00:00+08:00`;
  const end = `${nextDate(range.to)}T00:00:00+08:00`;
  const result = await db.query<EventRow>(`
    WITH events AS (
      SELECT t.created_at AS occurred_at, t.service_name, t.barber_name, t.payment_method,
        'sale'::text AS event_type, t.amount, 1 AS transaction_count
      FROM transactions t
      WHERE t.branch_id=ANY($3::integer[]) AND t.status IN ('completed','refunded','voided')
        AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
      UNION ALL
      SELECT a.created_at, t.service_name, t.barber_name, t.payment_method,
        a.action_type, a.amount, 0
      FROM transaction_financial_actions a
      JOIN transactions t ON t.id=a.transaction_id
      WHERE t.branch_id=ANY($3::integer[]) AND a.created_at >= $1::timestamptz AND a.created_at < $2::timestamptz
      UNION ALL
      -- Pre-Phase-5 reversed rows have no action timestamp. Attribute those
      -- reversals to their saved transaction date, once per transaction.
      SELECT t.created_at, t.service_name, t.barber_name, t.payment_method,
        CASE t.status WHEN 'refunded' THEN 'refund' ELSE 'void' END, t.amount, 0
      FROM transactions t
      WHERE t.branch_id=ANY($3::integer[]) AND t.status IN ('refunded','voided')
        AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
        AND NOT EXISTS (SELECT 1 FROM transaction_financial_actions a WHERE a.transaction_id=t.id)
    )
    SELECT (occurred_at AT TIME ZONE 'Asia/Manila')::date::text AS day,
      service_name, barber_name, payment_method, event_type,
      SUM(amount)::text AS amount, SUM(transaction_count)::text AS transaction_count
    FROM events
    GROUP BY day, service_name, barber_name, payment_method, event_type
  `, [start, end, branchIds]);
  return summarizeRevenueEvents(range, result.rows);
}
