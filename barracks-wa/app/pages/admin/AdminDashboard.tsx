"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { useEffect, useState, type ReactNode } from "react";
import type { ViewId } from "@/app/types/domain";
import type { ApiUser } from "@/app/lib/api";
import { ReportBranchScope } from "@/app/components/ReportBranchScope";
import type { ManagementDashboardData } from "@/app/types/dashboard";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { formatCurrency } from "@/app/utils/format";
import {
  Button,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/app/components/ui";
import { FreshnessBar } from "@/app/components/operations/OperationalPrimitives";

type DashboardProps = {
  go: (view: ViewId) => void;
  onToast: (message: string) => void;
  currentUser: ApiUser;
};
export function AdminDashboard(props: DashboardProps) {
  return (
    <ReportBranchScope globalAllowed={props.currentUser.role === "administrator"}>
      {(branch, branchControl) => (
        <AdminDashboardContent {...props} branch={branch} branchControl={branchControl} />
      )}
    </ReportBranchScope>
  );
}
function AdminDashboardContent({
  go,
  onToast,
  currentUser,
  branch,
  branchControl,
}: DashboardProps & { branch: string; branchControl: ReactNode }) {
  const [dashboard, setDashboard] = useState<ManagementDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const response = await apiRequest(`/api/dashboard/management?branchId=${branch}`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          dashboard?: ManagementDashboardData;
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !body.dashboard)
          throw new Error(body?.message ?? "Unable to load dashboard");
        if (active) {
          setDashboard(body.dashboard);
          setLoadError("");
          setUpdatedAt(Date.now());
        }
      } catch (cause) {
        if (active) {
          const message = cause instanceof Error ? cause.message : "Unable to load dashboard";
          setLoadError(message);
          onToast(message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onToast, branch, refreshVersion]);
  const sales = dashboard?.sales;
  const initialLoading = loading && dashboard === null;
  const unavailable = initialLoading || Boolean(loadError);
  const amount = (value: number | undefined) =>
    unavailable || !sales || value === undefined ? "—" : formatCurrency(value);
  const count = (value: number | undefined) =>
    unavailable || value === undefined ? "—" : String(value);
  const days = sales
    ? Array.from({ length: 7 }, (_, index) => {
        const day = new Date(`${sales.range.from}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() + index);
        const date = day.toISOString().slice(0, 10);
        const record = sales.dailySales.find((item) => item.label === date);
        return {
          date,
          gross: record?.grossSales ?? 0,
          refund: record?.refundedAmount ?? 0,
          voided: record?.voidedAmount ?? 0,
          net: record?.netRevenue ?? 0,
        };
      })
    : [];
  const max = Math.max(1, ...days.map((day) => day.gross));
  return (
    <div className="operational-workspace management-overview">
      <PageHeader
        title={currentUser.role === "manager" ? "Manager dashboard" : "Admin dashboard"}
        action={
          <>
            <FreshnessBar
              updatedAt={updatedAt}
              loading={loading}
              error={loadError}
              onRefresh={() => setRefreshVersion((value) => value + 1)}
            />
            {branchControl}
            <Button variant="secondary" onClick={() => go("payments")}>
              Open transactions
            </Button>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Paid sales · 7 days"
          value={amount(sales?.summary.grossSales)}
          icon="wallet"
          accent="blue"
        />
        <MetricCard
          label="Refunds + voids · 7 days"
          value={amount(sales?.summary.reversedAmount)}
          icon="creditCard"
          accent="amber"
        />
        <MetricCard
          label="Net sales · 7 days"
          value={amount(sales?.summary.netRevenue)}
          icon="chart"
          accent="green"
        />
        <MetricCard
          label="Paid visits · 7 days"
          value={unavailable || !sales ? "—" : String(sales.summary.transactionCount)}
          icon="check"
          accent="blue"
        />
      </div>
      <div className="management-activity-grid">
        <Panel>
          <SectionHeading title="Sales by day" />
          {initialLoading ? (
            <SkeletonRows count={4} label="Loading sales" />
          ) : loadError ? (
            <p role="alert">Sales unavailable while the overview refresh failed.</p>
          ) : dashboard?.salesError || !sales ? (
            <p role="alert">{dashboard?.salesError ?? "Sales aggregation unavailable"}</p>
          ) : !sales.summary.transactionCount && !sales.summary.reversedAmount ? (
            <EmptyState
              title="No sales activity in this period"
              description="Paid visits and financial actions will appear here."
            />
          ) : (
            <>
              <div
                className="sales-trend"
                role="img"
                aria-label="Paid sales over seven days; exact sales, refund and void values are listed below"
              >
                {days.map((day) => (
                  <div key={day.date}>
                    <em>{day.gross ? formatCurrency(day.gross) : ""}</em>
                    <span
                      className="sales-trend__bar"
                      style={{ height: `${(day.gross / max) * 140}px` }}
                    />
                    <span>{day.date.slice(5)}</span>
                  </div>
                ))}
              </div>
              <details className="sales-breakdown">
                <summary>Daily breakdown</summary>
                <div className="operational-table-wrap">
                  <table className="operational-table sales-summary">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Paid sales</th>
                        <th scope="col">Refunds</th>
                        <th scope="col">Voids</th>
                        <th scope="col">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{day.date}</th>
                          <td>{formatCurrency(day.gross)}</td>
                          <td>{formatCurrency(day.refund)}</td>
                          <td>{formatCurrency(day.voided)}</td>
                          <td>{formatCurrency(day.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="task-note">Net = paid sales − refunds − voids.</p>
              </details>
            </>
          )}
        </Panel>
        <Panel className="management-attention-panel">
          <SectionHeading title="Needs attention" />
          <div
            className="management-attention-list"
            role="region"
            aria-label="Needs attention entries"
            tabIndex={0}
          >
            {initialLoading ? (
              <SkeletonRows count={4} label="Loading exceptions" />
            ) : loadError ? (
              <p role="alert">Exceptions unavailable. Refresh to retry.</p>
            ) : (
              <>
                {Boolean(dashboard?.pendingBookings) && (
                  <button type="button" className="attention-row" onClick={() => go("bookings")}>
                    <span>
                      <strong>Booking requests · {dashboard!.pendingBookings}</strong>
                      <small>Customers are waiting for you to confirm or reject</small>
                    </span>
                    <span>Review</span>
                  </button>
                )}
                {(dashboard?.actionableRestocks ?? []).map((request) => (
                  <a
                    className="attention-row"
                    key={request.id}
                    href={`/admin/restocks?request=${request.id}&branchId=${request.branchId}`}
                  >
                    <span>
                      <strong>
                        {request.status === "Delivered" ? "Receive stock" : "Confirm delivery"} · #
                        {request.id}
                      </strong>
                      <small>
                        {request.supplierName} · {request.branch}
                      </small>
                    </span>
                    <span>Open request</span>
                  </a>
                ))}
                {(dashboard?.lowStock ?? []).map((item) => (
                  <a
                    className="attention-row"
                    key={item.id}
                    href={`/admin/inventory?item=${item.id}&branchId=${item.branchId}`}
                  >
                    <span>
                      <strong>
                        {item.quantity === 0 ? "Out of stock" : "Low stock"} · {item.name}
                      </strong>
                      <small>
                        {item.branch ?? "Branch unavailable"} · {item.quantity} /{" "}
                        {item.minimumStock} {item.unit}
                      </small>
                    </span>
                    <span>Open item</span>
                  </a>
                ))}
                {!dashboard?.lowStock.length &&
                  !dashboard?.actionableRestocks?.length &&
                  !dashboard?.pendingBookings && <EmptyState title="Nothing needs attention" />}
              </>
            )}
          </div>
        </Panel>
      </div>
      <Panel>
        <SectionHeading title="Bookings and staffing" />
        <div className="overview-context">
          <div>
            <span>Today’s bookings</span>
            <strong>{count(dashboard?.todayBookings)}</strong>
          </div>
          <div>
            <span>Upcoming confirmed</span>
            <strong>{count(dashboard?.upcomingBookings)}</strong>
          </div>
          <div>
            <span>Active barbers</span>
            <strong>{count(dashboard?.activeBarbers)}</strong>
          </div>
          <div>
            <span>Open restocks</span>
            <strong>{count(dashboard?.openRestocks)}</strong>
          </div>
        </div>
        <div className="overview-links">
          <Button variant="ghost" onClick={() => go("admin-barbers")}>
            Barber schedules
          </Button>
          <Button variant="ghost" onClick={() => go("admin-attendance")}>
            Attendance
          </Button>
          <Button variant="ghost" onClick={() => go("admin-restocks")}>
            Restocks
          </Button>
        </div>
      </Panel>
      <details className="overview-secondary">
        <summary>Inventory value and recent deliveries</summary>
        <p>
          Inventory at recorded unit cost:{" "}
          {unavailable ? "—" : formatCurrency(dashboard?.inventoryValue ?? 0)} · selected scope,
          current stock snapshot.
        </p>
        {!unavailable &&
          dashboard?.recentDeliveries.map((delivery) => (
            <p key={delivery.id}>
              {delivery.supplier_name} · Request #{delivery.id} ·{" "}
              {delivery.received_at
                ? new Date(delivery.received_at).toLocaleString("en-PH", {
                    timeZone: "Asia/Manila",
                  })
                : "Received"}
            </p>
          ))}
      </details>
    </div>
  );
}
