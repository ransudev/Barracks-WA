"use client";

import { Badge, EmptyState, MetricCard, Panel, SectionHeading } from "@/app/components/ui";
import { formatCurrency } from "@/app/utils/format";
import type { ReportRange } from "./report-utils";
import { RankedBars, ReportDetails, ReportStatus } from "./ReportVisuals";
import { useReport } from "./useReport";
import styles from "./reports.module.css";

type UsageRow = {
  itemId: number;
  branchId: number;
  itemName: string;
  branch: string;
  currentQuantity: number | null;
  minimumStock: number | null;
  received: number;
  used: number;
  sold: number;
  wasted: number;
  adjusted: number;
  currentActivity: number;
  previousActivity: number;
};
type ReportBody = {
  success: boolean;
  message?: string;
  range?: { from: string; to: string; previousFrom: string; previousTo: string };
  valuation?: { totalValue: number; activeItems: number; lowStockItems: number };
  supplierSpending?: Array<{
    supplierId: number;
    supplierName: string;
    totalSpend: number | null;
    receivedDeliveries: number;
  }>;
  usageSummary?: UsageRow[];
  movements?: Array<{
    id: number;
    movement_type: string;
    quantity: number;
    previous_stock: number;
    new_stock: number;
    item_name: string;
    branch: string;
    supplier_name: string | null;
    created_by_name: string;
    created_at: string;
  }>;
};

export function InventoryReports({
  range,
  onToast,
  branch,
}: {
  range: ReportRange;
  branch: string;
  onToast: (message: string) => void;
}) {
  const { data, loading, error, retry } = useReport<ReportBody>(
    "/api/reports/inventory",
    range,
    onToast,
    branch,
  );
  const valuation = data?.valuation;
  const usage = data?.usageSummary ?? [];
  const activeUsage = [...usage]
    .filter((row) => row.currentActivity > 0)
    .sort((a, b) => b.currentActivity - a.currentActivity);
  const lowStock = usage
    .filter(
      (row) =>
        row.currentQuantity !== null &&
        row.minimumStock !== null &&
        row.currentQuantity <= row.minimumStock,
    )
    .sort(
      (a, b) =>
        (b.minimumStock ?? 0) -
        (b.currentQuantity ?? 0) -
        ((a.minimumStock ?? 0) - (a.currentQuantity ?? 0)),
    );
  const suppliers = data?.supplierSpending ?? [];
  const movements = data?.movements ?? [];

  return (
    <>
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Current stock value"
          value={valuation ? formatCurrency(valuation.totalValue) : "—"}
          icon="box"
          accent="blue"
        />
        <MetricCard
          label="Current active items"
          value={valuation ? String(valuation.activeItems) : "—"}
          icon="check"
          accent="green"
        />
        <MetricCard
          label="Low stock now"
          value={valuation ? String(valuation.lowStockItems) : "—"}
          icon="info"
          accent="amber"
        />
        <MetricCard
          label="Suppliers with period spend"
          value={
            data
              ? String(
                  suppliers.filter(
                    (supplier) => supplier.totalSpend !== null && supplier.totalSpend > 0,
                  ).length,
                )
              : "—"
          }
          icon="users"
          accent="violet"
        />
      </div>
      <ReportStatus loading={loading} error={error} retry={retry} />
      {data && (
        <>
          <div className={styles.visualGrid}>
            <Panel className={`${styles.visualPanel} ${styles.matchedPanel}`}>
              <SectionHeading title="Stock needs attention" />
              <div
                className={styles.scrollBody}
                role="region"
                aria-label="Stock needs attention"
                tabIndex={0}
              >
                {lowStock.length ? (
                  <ul className={styles.stockList}>
                    {lowStock.slice(0, 6).map((row) => (
                      <li key={`${row.itemId}:${row.branchId}`}>
                        <div>
                          <strong>{row.itemName}</strong>
                          <small>{row.branch}</small>
                        </div>
                        <div>
                          <Badge tone="warning">{row.currentQuantity} left</Badge>
                          <small>Minimum {row.minimumStock}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon="check"
                    title="No items below minimum"
                    description="All active items are above their stock thresholds."
                  />
                )}
                {lowStock.length > 6 && (
                  <p className={styles.note}>
                    {lowStock.length - 6} more low-stock items in the full breakdown below.
                  </p>
                )}
              </div>
            </Panel>
            <RankedBars
              title="Supplier spending"
              description="Cost of received deliveries in the selected period."
              rows={suppliers
                .filter((supplier) => supplier.totalSpend !== null && supplier.totalSpend > 0)
                .map((supplier) => ({
                  id: supplier.supplierId,
                  label: supplier.supplierName,
                  value: supplier.totalSpend ?? 0,
                  detail: `${supplier.receivedDeliveries} received deliveries`,
                }))}
              format={formatCurrency}
            >
              <ReportDetails title="Supplier spending breakdown">
                {suppliers.length ? (
                  <table className={styles.table}>
                    <caption>Supplier spending in the selected period</caption>
                    <thead>
                      <tr>
                        <th scope="col">Supplier</th>
                        <th scope="col">Received deliveries</th>
                        <th scope="col">Total spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.map((supplier) => (
                        <tr key={supplier.supplierId}>
                          <th scope="row">{supplier.supplierName}</th>
                          <td>{supplier.receivedDeliveries}</td>
                          <td>
                            {supplier.totalSpend === null
                              ? "Unknown"
                              : formatCurrency(supplier.totalSpend)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className={styles.note}>No supplier records.</p>
                )}
              </ReportDetails>
            </RankedBars>
          </div>
          <Panel className={styles.visualPanel}>
            <SectionHeading
              title="Where stock is going"
              description="Top 6 items by outgoing quantity. Each bar shows that item’s mix."
            />
            <div className={styles.legend}>
              <span>
                <i className={styles.usedSegment} />
                Used
              </span>
              <span>
                <i className={styles.soldSegment} />
                Sold
              </span>
              <span>
                <i className={styles.wasteSegment} />
                Wasted
              </span>
            </div>
            {activeUsage.length ? (
              <ul className={styles.usageList}>
                {activeUsage.slice(0, 6).map((row) => (
                  <li key={`${row.itemId}:${row.branchId}`}>
                    <div className={styles.rankLabel}>
                      <strong>
                        {row.itemName} <small>{row.branch}</small>
                      </strong>
                      <span>{row.currentActivity} outgoing</span>
                    </div>
                    <div className={styles.stackedBar} aria-hidden="true">
                      <span
                        className={styles.usedSegment}
                        style={{ width: `${(row.used / row.currentActivity) * 100}%` }}
                      />
                      <span
                        className={styles.soldSegment}
                        style={{ width: `${(row.sold / row.currentActivity) * 100}%` }}
                      />
                      <span
                        className={styles.wasteSegment}
                        style={{ width: `${(row.wasted / row.currentActivity) * 100}%` }}
                      />
                    </div>
                    <div className={styles.usageMeta}>
                      <span>
                        {row.used} used · {row.sold} sold · {row.wasted} wasted
                      </span>
                      <span>
                        Previous period: {row.previousActivity}
                        {row.previousActivity > 0
                          ? ` · ${row.currentActivity > row.previousActivity ? "+" : ""}${(((row.currentActivity - row.previousActivity) / row.previousActivity) * 100).toFixed(0)}%`
                          : " · No previous activity"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="box"
                title="No outgoing stock in this period"
                description="Usage, sales, and waste will appear once recorded."
              />
            )}
            {data.range && (
              <p className={styles.note}>
                Previous period: {data.range.previousFrom} – {data.range.previousTo}. Quantities use
                the recorded item units; bars show composition, not a shared quantity scale.
              </p>
            )}
            <ReportDetails title="Full usage and current stock breakdown">
              {usage.length ? (
                <table className={styles.table}>
                  <caption>Period usage and current stock by item</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item / branch</th>
                      <th scope="col">Used</th>
                      <th scope="col">Sold</th>
                      <th scope="col">Wasted</th>
                      <th scope="col">Received</th>
                      <th scope="col">Adjusted</th>
                      <th scope="col">Outgoing / previous</th>
                      <th scope="col">Current stock / minimum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((row) => (
                      <tr key={`${row.itemId}:${row.branchId}`}>
                        <th scope="row">
                          {row.itemName}
                          <small>{row.branch}</small>
                        </th>
                        <td>{row.used}</td>
                        <td>{row.sold}</td>
                        <td>{row.wasted}</td>
                        <td>{row.received}</td>
                        <td>{row.adjusted}</td>
                        <td>
                          {row.currentActivity} / {row.previousActivity}
                        </td>
                        <td>
                          {row.currentQuantity ?? "—"} / {row.minimumStock ?? "—"}
                          <small>
                            {row.currentQuantity === null || row.minimumStock === null
                              ? "Historical record"
                              : row.currentQuantity <= row.minimumStock
                                ? "Low stock"
                                : "In stock"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.note}>No active inventory items.</p>
              )}
            </ReportDetails>
          </Panel>
          <Panel className={styles.visualPanel}>
            <SectionHeading title="Stock movement history" />
            <ReportDetails title={`Recent movements (${movements.length})`}>
              {movements.length ? (
                <>
                  <p className={styles.note}>
                    Showing up to the latest 250 movements in the selected period.
                  </p>
                  <table className={styles.table}>
                    <caption>Recent stock movements in Manila time</caption>
                    <thead>
                      <tr>
                        <th scope="col">Item / date</th>
                        <th scope="col">Movement</th>
                        <th scope="col">Stock change</th>
                        <th scope="col">Branch / supplier</th>
                        <th scope="col">Recorded by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((movement) => (
                        <tr key={movement.id}>
                          <th scope="row">
                            {movement.item_name}
                            <small>
                              {new Date(movement.created_at).toLocaleString("en-PH", {
                                timeZone: "Asia/Manila",
                              })}
                            </small>
                          </th>
                          <td>
                            {movement.movement_type} × {movement.quantity}
                          </td>
                          <td>
                            {movement.previous_stock} → {movement.new_stock}
                          </td>
                          <td>
                            {movement.branch}
                            <small>{movement.supplier_name ?? "No supplier"}</small>
                          </td>
                          <td>{movement.created_by_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className={styles.note}>No stock movements in this period.</p>
              )}
            </ReportDetails>
          </Panel>
        </>
      )}
    </>
  );
}
