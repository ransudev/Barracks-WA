"use client";

import { Button, EmptyState, Pagination, Panel, SelectField, TextField } from "@/app/components/ui";
import { ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import type { PayrollOverview } from "@/app/types/payroll";
import { lastDay, payrollMoney, statusLabel } from "@/app/utils/payroll";
import { Status } from "./shared";

export type PayrollFilters = {
  period: string;
  search: string;
  status: string;
  barberFilter: string;
};

export function PayrollRecordsView({
  overview,
  tab,
  filters: { period, search, status, barberFilter },
  page,
  onFiltersChange,
  onPageChange,
  onOpenSettings,
  onReview,
}: {
  overview: PayrollOverview;
  tab: "overview" | "history";
  filters: PayrollFilters;
  page: number;
  onFiltersChange: (patch: Partial<PayrollFilters>) => void;
  onPageChange: (page: number) => void;
  onOpenSettings: () => void;
  onReview: (recordId: string) => void;
}) {
  return (
    <>
      {tab === "overview" && overview.currentPeriod && (
        <Panel>
          <div className="payroll-section-head">
            <h2>Current period</h2>
            <span className="payroll-period">
              {overview.currentPeriod.start} – {lastDay(overview.currentPeriod.end)}
            </span>
          </div>
          {overview.currentEarnings.length ? (
            <ResponsiveTable
              className="payroll-earnings-table"
              headers={["Barber", "Completed paid services", "Accrued commission"]}
            >
              {overview.currentEarnings.map((e) => (
                <tr key={e.barber_id}>
                  <td>{e.barber_name}</td>
                  <td>{e.service_count}</td>
                  <td>{payrollMoney(e.gross_centavos)}</td>
                </tr>
              ))}
            </ResponsiveTable>
          ) : (
            <p className="payroll-muted">No paid services in this period yet.</p>
          )}
          {overview.unassigned.service_count > 0 && (
            <p className="payroll-muted">
              {overview.unassigned.service_count} services ·{" "}
              {payrollMoney(overview.unassigned.gross_centavos)} awaiting a draft.
            </p>
          )}
          {overview.unassigned.before_calendar > 0 && (
            <p role="alert">
              {overview.unassigned.before_calendar} confirmed services predate the configured first
              period. Review their source evidence and handle them as explicit, referenced
              adjustments in a Draft; they are not silently moved to a different period.
            </p>
          )}
        </Panel>
      )}
      <Panel className="payroll-records-panel">
        <div className="payroll-section-head">
          <h2>{tab === "history" ? "Payroll history" : "Payroll records"}</h2>
          {!overview.settings && (
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Set up payroll calendar
            </Button>
          )}
        </div>
        {overview.unresolved.length > 0 && (
          <p className="payroll-notice">
            <span>
              {overview.unresolved.length} completed{" "}
              {overview.unresolved.length === 1 ? "service needs" : "services need"} a historical
              rate.
            </span>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              Review rates
            </Button>
          </p>
        )}
        <div className="payroll-filters">
          <TextField
            aria-label="Period start"
            type="date"
            value={period}
            onChange={(e) => onFiltersChange({ period: e.target.value })}
          />
          <SelectField
            aria-label="Barber"
            value={barberFilter}
            onChange={(e) => onFiltersChange({ barberFilter: e.target.value })}
          >
            <option value="">All barbers</option>
            {overview.barbers.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <TextField
            aria-label="Search barber name"
            placeholder="Search barber"
            icon="search"
            value={search}
            maxLength={100}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
          <SelectField
            aria-label="Status"
            value={status}
            onChange={(e) => onFiltersChange({ status: e.target.value })}
          >
            <option value="">All statuses</option>
            {["draft", "pending_approval", "approved", "paid"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </SelectField>
        </div>
        <dl className="payroll-metrics">
          <div>
            <dt>Unpaid payable</dt>
            <dd>{payrollMoney(overview.summary.payable_centavos)}</dd>
          </div>
          <div>
            <dt>Barbers</dt>
            <dd>{overview.summary.barbers}</dd>
          </div>
          <div>
            <dt>Pending approval</dt>
            <dd className={overview.summary.pending ? "is-warning" : undefined}>
              {overview.summary.pending}
            </dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{overview.summary.paid}</dd>
          </div>
        </dl>
        {overview.records.length ? (
          <ResponsiveTable
            className="payroll-records-table"
            headers={[
              "Barber / period",
              "Services",
              "Gross",
              "Adjustments",
              "Payable",
              "Status",
              "",
            ]}
          >
            {overview.records.map((record) => (
              <tr key={record.id}>
                <td>
                  <strong>{record.barber_name}</strong>
                  <small>
                    {record.period_start} – {lastDay(record.period_end_exclusive)}
                    {record.supplemental_to && ` · Supplement to #${record.supplemental_to}`}
                  </small>
                </td>
                <td>{record.service_count}</td>
                <td>{payrollMoney(record.gross_centavos)}</td>
                <td>{payrollMoney(record.adjustments_centavos)}</td>
                <td>
                  <strong>{payrollMoney(record.payable_centavos)}</strong>
                </td>
                <td>
                  <Status record={record} />
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconAfter="chevronRight"
                    onClick={() => onReview(record.id)}
                  >
                    Review
                  </Button>
                </td>
              </tr>
            ))}
          </ResponsiveTable>
        ) : (
          <EmptyState
            title="No payroll records"
            description={
              overview.settings
                ? "Generate a draft once a period closes."
                : "Set up the payroll calendar first."
            }
          />
        )}
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil(overview.summary.total_records / 50))}
          onPageChange={onPageChange}
          summary={`${overview.summary.total_records} record${overview.summary.total_records === 1 ? "" : "s"}`}
        />
      </Panel>
    </>
  );
}
