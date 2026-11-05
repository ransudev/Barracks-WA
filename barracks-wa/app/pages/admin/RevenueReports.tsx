"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, MetricCard, Panel, SectionHeading } from "@/app/components/ui";
import { formatCurrency } from "@/app/utils/format";
import type { RevenueGroup, RevenueReport } from "@/server/services/revenue-report.service";
import { displayDate, shiftDate, type ReportRange } from "./report-utils";
import { RankedBars, ReportDetails, ReportStatus } from "./ReportVisuals";
import { useReport } from "./useReport";
import styles from "./reports.module.css";

type ReportBody = RevenueReport & { success: boolean; message?: string };
type Metric = "grossSales" | "netRevenue" | "transactionCount";
const metrics: { key: Metric; label: string }[] = [
  { key: "grossSales", label: "Gross sales" },
  { key: "netRevenue", label: "Net revenue" },
  { key: "transactionCount", label: "Transactions" },
];
const emptyDay = (label: string): RevenueGroup => ({
  label,
  grossSales: 0,
  netRevenue: 0,
  transactionCount: 0,
  reversedAmount: 0,
  refundedAmount: 0,
  voidedAmount: 0,
});
const metricValue = (value: number, metric: Metric) =>
  metric === "transactionCount" ? value.toLocaleString() : formatCurrency(value);

function RevenueTable({ title, rows }: { title: string; rows: RevenueGroup[] }) {
  return (
    <ReportDetails title={title}>
      {rows.length ? (
        <table className={styles.table}>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Date / group</th>
              <th scope="col">Transactions</th>
              <th scope="col">Gross sales</th>
              <th scope="col">Refunded</th>
              <th scope="col">Voided</th>
              <th scope="col">Net revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.transactionCount}</td>
                <td>{formatCurrency(row.grossSales)}</td>
                <td>{formatCurrency(row.refundedAmount)}</td>
                <td>{formatCurrency(row.voidedAmount)}</td>
                <td>{formatCurrency(row.netRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.note}>No sales or reversals in this period.</p>
      )}
    </ReportDetails>
  );
}

function DailyActivity({ data, range }: { data: RevenueReport; range: ReportRange }) {
  const [view, setView] = useState<"trend" | "calendar">("calendar");
  const [metric, setMetric] = useState<Metric>("grossSales");
  const [month, setMonth] = useState(`${range.to.slice(0, 7)}-01`);
  const [selected, setSelected] = useState<RevenueGroup | null>(null);
  const daily = useMemo(
    () => new Map(data.dailySales.map((row) => [row.label, row])),
    [data.dailySales],
  );
  // Long periods use equal-sized date buckets, keeping the chart bounded to 60 points.
  const days =
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000,
    ) + 1;
  const bucketSize = Math.max(1, Math.ceil(days / 60));
  const buckets = useMemo(() => {
    const result = Array.from({ length: Math.ceil(days / bucketSize) }, (_, index) => ({
      ...emptyDay(shiftDate(range.from, index * bucketSize)),
      end: shiftDate(range.from, Math.min(days - 1, (index + 1) * bucketSize - 1)),
    }));
    for (const row of data.dailySales) {
      const index = Math.floor(
        (Date.parse(`${row.label}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) /
          86400000 /
          bucketSize,
      );
      const bucket = result[index];
      if (bucket)
        for (const field of [
          "grossSales",
          "netRevenue",
          "transactionCount",
          "reversedAmount",
          "refundedAmount",
          "voidedAmount",
        ] as const)
          bucket[field] += row[field];
    }
    return result;
  }, [data.dailySales, range.from, days, bucketSize]);
  const minimum = Math.min(0, ...buckets.map((row) => row[metric]));
  const chartMaximum = Math.max(0, ...buckets.map((row) => row[metric])) || (minimum === 0 ? 1 : 0);
  const extent = chartMaximum - minimum;
  const pointY = (value: number) => 8 + ((chartMaximum - value) / extent) * 84;
  const points = buckets.map((row, index) => ({
    row,
    x: buckets.length === 1 ? 50 : 2 + (index / (buckets.length - 1)) * 96,
    y: pointY(row[metric]),
  }));
  const monthStart = new Date(`${month}T00:00:00Z`);
  const monthDays = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const offset = (monthStart.getUTCDay() + 6) % 7;
  const calendarMax = Math.max(1, ...data.dailySales.map((row) => Math.abs(row[metric])));
  const moveMonth = (offset: number) => {
    const date = new Date(`${month}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    setMonth(date.toISOString().slice(0, 10));
  };

  return (
    <Panel className={styles.visualPanel}>
      <SectionHeading title="Daily activity" />
      <div className={styles.chartControls}>
        <div className={styles.tabs} role="group" aria-label="Daily activity view">
          {(["calendar", "trend"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={view === value}
              onClick={() => {
                setView(value);
                setSelected(null);
              }}
            >
              {value === "trend" ? "Line chart" : "Calendar"}
            </Button>
          ))}
        </div>
        <div className={styles.tabs} role="group" aria-label="Daily activity measure">
          {metrics.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={metric === item.key ? "secondary" : "ghost"}
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      {!data.dailySales.length ? (
        <EmptyState
          title="No sales or reversals in this period"
          description="Choose another period to explore daily activity."
        />
      ) : view === "trend" ? (
        <>
          <div className={styles.chartFrame}>
            <div className={styles.yAxis} aria-hidden="true">
              {[chartMaximum, (chartMaximum + minimum) / 2, minimum].map((value, index) => (
                <span key={index} style={{ top: `${8 + index * 42}%` }}>
                  {metricValue(value, metric)}
                </span>
              ))}
            </div>
            <div
              className={styles.linePlot}
              role="group"
              aria-label={`${metrics.find((item) => item.key === metric)?.label} line chart by ${bucketSize === 1 ? "day" : `${bucketSize}-day period`} hint: select a point for exact figures`}
            >
              <svg
                viewBox="0 0 1000 240"
                preserveAspectRatio="none"
                className={styles.lineSvg}
                aria-hidden="true"
              >
                {[8, 50, 92].map((y) => (
                  <line
                    key={y}
                    x1="20"
                    x2="980"
                    y1={y * 2.4}
                    y2={y * 2.4}
                    className={styles.gridLine}
                  />
                ))}
                <line
                  x1="20"
                  x2="980"
                  y1={pointY(0) * 2.4}
                  y2={pointY(0) * 2.4}
                  className={styles.zeroLine}
                />
                <polyline
                  points={points.map(({ x, y }) => `${x * 10},${y * 2.4}`).join(" ")}
                  className={styles.trendLine}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {points.map(({ row, x, y }) => (
                <button
                  type="button"
                  key={row.label}
                  className={`${styles.chartPoint} ${row[metric] < 0 ? styles.negativePoint : ""}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  aria-pressed={
                    selected?.label ===
                    (row.end === row.label ? row.label : `${row.label} – ${row.end}`)
                  }
                  aria-label={`${row.label}${row.end !== row.label ? ` to ${row.end}` : ""}: ${metricValue(row[metric], metric)}`}
                  title={`${displayDate(row.label)}${row.end !== row.label ? ` – ${displayDate(row.end)}` : ""}: ${metricValue(row[metric], metric)}`}
                  onClick={() =>
                    setSelected({
                      ...row,
                      label: row.end === row.label ? row.label : `${row.label} – ${row.end}`,
                    })
                  }
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <div className={styles.lineAxis}>
            <span>{displayDate(range.from)}</span>
            <span>{displayDate(range.to)}</span>
          </div>
          <p className={styles.note}>
            {bucketSize === 1
              ? "Each point represents one day."
              : `Each point totals up to ${bucketSize} days.`}{" "}
            Select a point for exact figures. Red points below zero show negative net revenue.
          </p>
        </>
      ) : (
        <>
          <div className={styles.monthToolbar}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Previous month"
              disabled={month.slice(0, 7) <= range.from.slice(0, 7)}
              onClick={() => moveMonth(-1)}
            >
              Previous
            </Button>
            <strong>{displayDate(month, { month: "long", year: "numeric" })}</strong>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Next month"
              disabled={month.slice(0, 7) >= range.to.slice(0, 7)}
              onClick={() => moveMonth(1)}
            >
              Next
            </Button>
          </div>
          <div className={styles.calendar} role="group" aria-label="Daily sales calendar">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span className={styles.weekday} key={day}>
                {day}
              </span>
            ))}
            {Array.from({ length: offset }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: monthDays }, (_, index) => {
              const day = `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`;
              const row = daily.get(day) ?? emptyDay(day);
              const outside = day < range.from || day > range.to;
              const level =
                row[metric] === 0
                  ? 0
                  : Math.max(1, Math.ceil((Math.abs(row[metric]) / calendarMax) * 4));
              return (
                <button
                  key={day}
                  type="button"
                  disabled={outside}
                  className={`${styles.calendarDay} ${styles[`heat${level}`]} ${row[metric] < 0 ? styles.negativeDay : ""}`}
                  aria-pressed={selected?.label === day}
                  aria-label={`${displayDate(day, { dateStyle: "full" })}: ${metricValue(row[metric], metric)}${outside ? ", outside selected period" : ""}`}
                  onClick={() => setSelected(row)}
                >
                  <span>{index + 1}</span>
                  <strong>{outside ? "—" : metricValue(row[metric], metric)}</strong>
                </button>
              );
            })}
          </div>
          <p className={styles.note}>
            Stronger shading means higher activity across the selected period. Red indicates
            negative net revenue. Select a date for details.
          </p>
        </>
      )}
      {selected && (
        <div className={styles.selection} role="status">
          <strong>{selected.label}</strong>
          <span>Gross {formatCurrency(selected.grossSales)}</span>
          <span>Net {formatCurrency(selected.netRevenue)}</span>
          <span>{selected.transactionCount} transactions</span>
          <span>
            Refunded {formatCurrency(selected.refundedAmount)} · Voided{" "}
            {formatCurrency(selected.voidedAmount)}
          </span>
        </div>
      )}
      <RevenueTable title="Daily sales breakdown" rows={data.dailySales} />
    </Panel>
  );
}

export function RevenueReports({
  range,
  onToast,
  branch,
}: {
  range: ReportRange;
  branch: string;
  onToast: (message: string) => void;
}) {
  const { data, loading, error, retry } = useReport<ReportBody>(
    "/api/reports/revenue",
    range,
    onToast,
    branch,
  );
  const busiest = data?.dailySales.reduce<RevenueGroup | null>(
    (best, row) => (!best || row.transactionCount > best.transactionCount ? row : best),
    null,
  );
  const topService = data?.byService[0];
  return (
    <>
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Gross sales"
          value={data ? formatCurrency(data.summary.grossSales) : "—"}
          icon="creditCard"
          accent="blue"
        />
        <MetricCard
          label="Refunded / voided"
          value={data ? formatCurrency(data.summary.reversedAmount) : "—"}
          icon="info"
          accent="amber"
        />
        <MetricCard
          label="Net revenue"
          value={data ? formatCurrency(data.summary.netRevenue) : "—"}
          icon="check"
          accent="green"
        />
        <MetricCard
          label="Transactions"
          value={data ? String(data.summary.transactionCount) : "—"}
          icon="info"
          accent="violet"
        />
      </div>
      <ReportStatus loading={loading} error={error} retry={retry} />
      {data && (
        <>
          <div className={styles.highlights}>
            <div>
              <small>Busiest day by checkouts</small>
              <strong>
                {busiest && busiest.transactionCount > 0
                  ? displayDate(busiest.label)
                  : "No checkouts"}
              </strong>
              <span>
                {busiest && busiest.transactionCount > 0
                  ? `${busiest.transactionCount} transactions`
                  : "in this period"}
              </span>
            </div>
            <div>
              <small>Highest net revenue service</small>
              <strong>{topService?.label ?? "No service activity"}</strong>
              <span>{topService ? formatCurrency(topService.netRevenue) : "in this period"}</span>
            </div>
            <div>
              <small>Average checkout value</small>
              <strong>
                {data.summary.transactionCount
                  ? formatCurrency(data.summary.grossSales / data.summary.transactionCount)
                  : "—"}
              </strong>
              <span>Gross sales ÷ transactions</span>
            </div>
          </div>
          <DailyActivity data={data} range={range} />
          <div className={styles.visualGrid}>
            <RankedBars
              title="Net revenue by service"
              rows={data.byService.map((row) => ({
                label: row.label,
                value: row.netRevenue,
                detail: `${row.transactionCount} transactions · Gross ${formatCurrency(row.grossSales)}`,
              }))}
              format={formatCurrency}
            >
              <RevenueTable title="Service breakdown" rows={data.byService} />
            </RankedBars>
            <RankedBars
              matchSibling
              title="Net revenue by barber"
              rows={data.byBarber.map((row) => ({
                label: row.label,
                value: row.netRevenue,
                detail: `${row.transactionCount} transactions · Gross ${formatCurrency(row.grossSales)}`,
              }))}
              format={formatCurrency}
            >
              <RevenueTable title="Barber breakdown" rows={data.byBarber} />
            </RankedBars>
          </div>
          <RankedBars
            title="Payment methods"
            description="Gross sales before refunds and voids."
            rows={data.byPaymentMethod.map((row) => ({
              label: row.label,
              value: row.grossSales,
              detail: `${row.transactionCount} transactions · ${data.summary.grossSales ? ((row.grossSales / data.summary.grossSales) * 100).toFixed(1) : "0"}% of gross sales`,
            }))}
            format={formatCurrency}
          >
            <RevenueTable title="Payment method breakdown" rows={data.byPaymentMethod} />
          </RankedBars>
          <p className={styles.note}>
            Sales use checkout dates; refunds and voids use action dates. Legacy reversals use the
            sale date. Net revenue may be negative.
          </p>
        </>
      )}
    </>
  );
}
