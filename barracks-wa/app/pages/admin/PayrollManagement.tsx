"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, readApiBody, type ApiRole } from "@/app/lib/api";
import { useBranchContext } from "@/app/utils/use-branch-context";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import type {
  PayrollDetail,
  PayrollOverview,
  PayrollRecord,
  PayrollRate,
  UnresolvedService,
} from "@/app/types/payroll";
import "./payroll.css";
import { payrollMoney } from "@/app/utils/payroll";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const lastDay = (end: string) =>
  new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const statusLabel = (status: string) => status.replaceAll("_", " ");
function Status({ record }: { record: PayrollRecord }) {
  return (
    <Badge
      tone={
        record.status === "paid"
          ? "success"
          : record.status === "pending_approval"
            ? "warning"
            : "neutral"
      }
    >
      {statusLabel(record.status)}
    </Badge>
  );
}
async function payrollRequest<T>(
  query: string,
  command?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiRequest(`/api/payroll${query}`, {
    cache: "no-store",
    signal,
    ...(command ? { method: "POST", body: JSON.stringify(command) } : {}),
  });
  const body = await readApiBody<T & { success: boolean; message?: string }>(response);
  if (!response.ok || !body?.success) throw new Error(body?.message ?? "Unable to load payroll");
  return body;
}
type Editor =
  | { kind: "configure" }
  | { kind: "generate" }
  | { kind: "rate"; barber: PayrollRate }
  | { kind: "correct_snapshot"; service: UnresolvedService }
  | {
      kind: "supplement" | "adjust" | "submit" | "return" | "approve" | "pay";
      record: PayrollRecord;
    };
const editorTitles: Record<Editor["kind"], string> = {
  configure: "Configure payroll calendar",
  generate: "Generate payroll draft",
  rate: "Set commission rate",
  correct_snapshot: "Confirm historical rate",
  supplement: "Create correction draft",
  adjust: "Add adjustment",
  submit: "Submit for approval",
  return: "Return to draft",
  approve: "Approve payroll",
  pay: "Record external disbursement",
};

export function PayrollManagement({
  currentUserRole,
  onToast,
}: {
  currentUserRole: ApiRole;
  onToast: (message: string) => void;
}) {
  if (currentUserRole !== "administrator" && currentUserRole !== "manager")
    return <p role="alert">You do not have access to payroll.</p>;
  return <PayrollBranches currentUserRole={currentUserRole} onToast={onToast} />;
}
function PayrollBranches(props: { currentUserRole: ApiRole; onToast: (message: string) => void }) {
  const context = useBranchContext();
  return <BranchPayroll key={context.branchId} {...props} context={context} />;
}
function BranchPayroll({
  currentUserRole,
  onToast,
  context,
}: {
  currentUserRole: ApiRole;
  onToast: (message: string) => void;
  context: ReturnType<typeof useBranchContext>;
}) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = context;
  const [tab, setTab] = useState<"overview" | "settings" | "history">("overview");
  const [overview, setOverview] = useState<PayrollOverview | null>(null);
  const [period, setPeriod] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [barberFilter, setBarberFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(branchId));
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [sourceId, setSourceId] = useState("");
  const slip = useRef<HTMLDivElement>(null);
  const branch = branches.find((item) => item.id === branchId);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController();
    const filters = new URLSearchParams({ branchId: String(branchId) });
    if (selected) filters.set("recordId", selected);
    else {
      if (period) filters.set("periodStart", period);
      if (search) filters.set("search", search);
      if (status) filters.set("status", status);
      if (barberFilter) filters.set("barberId", barberFilter);
      filters.set("page", String(page));
    }
    const frame = window.requestAnimationFrame(() => {
      setLoading(true);
      setError("");
      setDetail(null);
      void payrollRequest<PayrollOverview | PayrollDetail>(
        `?${filters}`,
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          if ("record" in data) setDetail(data);
          else setOverview(data);
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "Unable to load payroll");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [branchId, period, search, status, barberFilter, page, selected, revision]);
  function edit(next: Editor) {
    setEditor(next);
    setValue(
      next.kind === "rate"
        ? (next.barber.current_rate ?? "")
        : next.kind === "generate"
          ? period
          : "",
    );
    setReason("");
    setEffective("");
    setMethod("cash");
    setReference("");
    setSourceId("");
    setFormError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || !branchId || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const base = { action: editor.kind, branchId };
      let command: object;
      if (editor.kind === "configure") command = { ...base, anchorDate: value };
      else if (editor.kind === "generate") command = { ...base, periodStart: value };
      else if (editor.kind === "rate")
        command = {
          ...base,
          barberId: editor.barber.id,
          rate: value,
          reason,
          ...(effective ? { effectiveAt: `${effective}:00+08:00` } : {}),
        };
      else if (editor.kind === "correct_snapshot")
        command = { ...base, snapshotId: Number(editor.service.id), rate: value, reason };
      else if (editor.kind === "adjust") {
        if (!/^-?\d+(?:\.\d{1,2})?$/.test(value))
          throw new Error("Enter a peso amount with up to two decimal places");
        const [whole, fraction = ""] = value.replace("-", "").split(".");
        const amount =
          (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) *
          (value.startsWith("-") ? -BigInt(1) : BigInt(1));
        command = {
          ...base,
          recordId: Number(editor.record.id),
          amountCentavos: amount.toString(),
          reason,
          ...(sourceId ? { sourceRecordId: Number(sourceId) } : {}),
        };
      } else if (editor.kind === "return" || editor.kind === "supplement")
        command = { ...base, recordId: Number(editor.record.id), reason };
      else if (editor.kind === "pay")
        command = {
          ...base,
          recordId: Number(editor.record.id),
          paidAt: effective ? `${effective}:00+08:00` : new Date().toISOString(),
          paymentMethod: method,
          reference,
        };
      else command = { ...base, recordId: Number(editor.record.id) };
      const result = await payrollRequest<{ message: string; recordId?: string }>("", command);
      if (editor.kind === "supplement" && result.recordId) setSelected(result.recordId);
      setEditor(null);
      setRevision((current) => current + 1);
      onToast(result.message);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Unable to save payroll");
    } finally {
      setSaving(false);
    }
  }
  function download() {
    if (!slip.current || detail?.record.status !== "paid") return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Barracks payslip</title><style>body{font:14px Arial,sans-serif;margin:32px;color:#17202a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}dl{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}dt{font-weight:bold}dd{margin:4px 0}small{display:block}</style></head><body>${slip.current.innerHTML}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip-${detail.record.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="payroll-workspace operational-workspace">
      <PageHeader
        title="Payroll"
        action={
          <BranchSwitcher
            branches={branches}
            value={branchId}
            loading={branchLoading}
            disabled={saving}
            onChange={setBranchId}
          />
        }
      />
      <div className="payroll-toolbar">
        <nav className="task-view-switch payroll-tabs" aria-label="Payroll sections">
          {(["overview", "history", "settings"] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={item === tab}
              aria-current={item === tab ? "page" : undefined}
              disabled={saving}
              onClick={() => {
                setTab(item);
                setSelected(null);
                setPage(1);
              }}
            >
              {item === "settings"
                ? "Commission settings"
                : item === "history"
                  ? "History"
                  : "Overview"}
            </button>
          ))}
        </nav>
        {overview?.settings && !detail && tab !== "settings" && (
          <Button icon="plus" onClick={() => edit({ kind: "generate" })}>
            Generate draft
          </Button>
        )}
      </div>
      {(branchError || error) && (
        <p className="form-error" role="alert">
          {branchError || error}{" "}
          <Button variant="ghost" onClick={() => setRevision((r) => r + 1)}>
            Retry
          </Button>
        </p>
      )}
      {loading && overview && !selected && <p role="status">Updating payroll…</p>}
      {(loading && (!overview || selected)) || branchLoading ? (
        <SkeletonRows count={6} label="Loading payroll" />
      ) : !branchId ? (
        <Panel>
          <EmptyState title="Select a branch" />
        </Panel>
      ) : detail ? (
        <>
          <div className="payroll-detail-actions">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Back to payroll
            </Button>
            <Status record={detail.record} />
            {detail.record.status === "draft" && (
              <>
                <Button onClick={() => edit({ kind: "submit", record: detail.record })}>
                  Submit for approval
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => edit({ kind: "adjust", record: detail.record })}
                >
                  Add adjustment
                </Button>
              </>
            )}
            {detail.record.status === "pending_approval" && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => edit({ kind: "return", record: detail.record })}
                >
                  Return to draft
                </Button>
                {currentUserRole === "manager" && (
                  <Button onClick={() => edit({ kind: "approve", record: detail.record })}>
                    Approve payroll
                  </Button>
                )}
              </>
            )}
            {detail.record.status === "approved" && (
              <Button onClick={() => edit({ kind: "pay", record: detail.record })}>
                Record full payment
              </Button>
            )}
            {["approved", "paid"].includes(detail.record.status) &&
              !detail.record.supplemental_to && (
                <Button
                  variant="secondary"
                  onClick={() => edit({ kind: "supplement", record: detail.record })}
                >
                  Create correction draft
                </Button>
              )}
            {detail.record.status === "paid" && (
              <>
                <Button variant="secondary" onClick={() => window.print()}>
                  Print / Save PDF
                </Button>
                <Button variant="secondary" onClick={download}>
                  Download payslip
                </Button>
              </>
            )}
          </div>
          <Panel>
            <div ref={slip} id="payroll-payslip">
              <PayrollSlip detail={detail} />
            </div>
          </Panel>
          <Panel>
            <h2>Audit history</h2>
            <ol className="payroll-audit">
              {detail.events.map((event) => (
                <li key={event.id}>
                  <strong>{statusLabel(event.action)}</strong> · {event.actor_name} ·{" "}
                  {dateTime(event.created_at)}
                  {event.reason && <p>{event.reason}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </>
      ) : overview && tab === "settings" ? (
        <>
          <Panel>
            <h2>Payroll calendar</h2>
            {overview.settings ? (
              <p>
                First period starts {overview.settings.anchor_date}. Every period lasts 14 days in
                Asia/Manila.
              </p>
            ) : (
              <>
                <p>Choose the first period start date before generating payroll.</p>
                <Button onClick={() => edit({ kind: "configure" })}>Configure calendar</Button>
              </>
            )}
          </Panel>
          <Panel>
            <h2>Commission rates</h2>
            <p className="payroll-muted">Rate changes apply to future services only.</p>
            <ResponsiveTable
              className="payroll-rates-table"
              headers={["Barber", "Current rate", "Action"]}
            >
              {overview.rates.map((barber) => (
                <tr key={barber.id}>
                  <td>
                    {barber.first_name} {barber.last_name}
                  </td>
                  <td>
                    {barber.current_rate === null ? "Not configured" : `${barber.current_rate}%`}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => edit({ kind: "rate", barber })}
                    >
                      Set future rate
                    </Button>
                  </td>
                </tr>
              ))}
            </ResponsiveTable>
            {overview.rates.map((barber) => (
              <details className="payroll-rate-history" key={barber.id}>
                <summary>
                  {barber.first_name} {barber.last_name} · Rate history ({barber.history.length})
                </summary>
                <ul>
                  {barber.history.map((change) => (
                    <li key={change.id}>
                      {change.old_rate ?? "Unconfigured"} → {change.commission_rate}% ·{" "}
                      {dateTime(change.effective_at)} · {change.actor_name || "Payroll activation"}
                      <p>{change.change_reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </Panel>
          {overview.unresolved.length > 0 && (
            <Panel>
              <h2>Historical rates to confirm ({overview.unresolved.length})</h2>
              <p className="payroll-muted">
                A manager must confirm the rate and evidence before these services accrue
                commission.
              </p>
              <ResponsiveTable
                className="payroll-unresolved-table"
                headers={[
                  "Barber / service",
                  "Completed in Manila",
                  "Original price",
                  "Payment",
                  "Action",
                ]}
              >
                {overview.unresolved.map((service) => (
                  <tr key={service.id}>
                    <td>
                      {service.barber_name}
                      <small>{service.service_name}</small>
                    </td>
                    <td>{dateTime(service.completed_at)}</td>
                    <td>{payrollMoney(service.original_price_centavos)}</td>
                    <td>
                      {service.transaction_reference ?? "Unpaid"}
                      <small>{service.transaction_status}</small>
                    </td>
                    <td>
                      {currentUserRole === "manager" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => edit({ kind: "correct_snapshot", service })}
                        >
                          Confirm historical rate
                        </Button>
                      ) : (
                        "Manager confirmation required"
                      )}
                    </td>
                  </tr>
                ))}
              </ResponsiveTable>
            </Panel>
          )}
          {overview.corrections.length > 0 && (
            <CorrectionApprovals corrections={overview.corrections} />
          )}
        </>
      ) : overview ? (
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
                  {overview.unassigned.before_calendar} confirmed services predate the configured
                  first period. Review their source evidence and handle them as explicit, referenced
                  adjustments in a Draft; they are not silently moved to a different period.
                </p>
              )}
            </Panel>
          )}
          <Panel className="payroll-records-panel">
            <div className="payroll-section-head">
              <h2>{tab === "history" ? "Payroll history" : "Payroll records"}</h2>
              {!overview.settings && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTab("settings");
                  }}
                >
                  Set up payroll calendar
                </Button>
              )}
            </div>
            {overview.unresolved.length > 0 && (
              <p className="payroll-notice">
                <span>
                  {overview.unresolved.length} completed{" "}
                  {overview.unresolved.length === 1 ? "service needs" : "services need"} a
                  historical rate.
                </span>
                <Button size="sm" variant="secondary" onClick={() => setTab("settings")}>
                  Review rates
                </Button>
              </p>
            )}
            <div className="payroll-filters">
              <TextField
                aria-label="Period start"
                type="date"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setPage(1);
                }}
              />
              <SelectField
                aria-label="Barber"
                value={barberFilter}
                onChange={(e) => {
                  setBarberFilter(e.target.value);
                  setPage(1);
                }}
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              <SelectField
                aria-label="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
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
                        onClick={() => setSelected(record.id)}
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
              onPageChange={setPage}
              summary={`${overview.summary.total_records} record${overview.summary.total_records === 1 ? "" : "s"}`}
            />
          </Panel>
        </>
      ) : null}
      <Modal
        open={Boolean(editor)}
        title={editor ? editorTitles[editor.kind] : ""}
        onClose={() => {
          if (!saving) setEditor(null);
        }}
      >
        <form className="modal-form" onSubmit={save}>
          {editor && "record" in editor && (
            <p>
              {editor.record.barber_name} · {editor.record.branch_name} · Payable{" "}
              {payrollMoney(editor.record.payable_centavos)}
            </p>
          )}
          {editor?.kind === "configure" && (
            <>
              <p>
                The first date defines contiguous 14-day periods. It cannot be changed once
                configured.
              </p>
              <TextField
                required
                label="First period start"
                type="date"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </>
          )}
          {editor?.kind === "generate" && (
            <>
              <p>
                Generate only after the period ends. Approved payroll stays locked; late earnings
                produce a supplement requiring its own approval.
              </p>
              <TextField
                required
                label="Period start"
                type="date"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <small>
                Calendar anchor: {overview?.settings?.anchor_date}. Ends 14 days after the selected
                start.
              </small>
            </>
          )}
          {(editor?.kind === "rate" || editor?.kind === "correct_snapshot") && (
            <>
              <p>
                {editor.kind === "rate"
                  ? `${editor.barber.first_name} ${editor.barber.last_name}`
                  : `${editor.service.barber_name} · ${editor.service.service_name} · ${dateTime(editor.service.completed_at)}`}
              </p>
              <TextField
                required
                label="Commission rate (%)"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {editor.kind === "rate" ? (
                <TextField
                  label="Future effective time (Manila; blank for now)"
                  type="datetime-local"
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              ) : (
                <p>
                  Your confirmation approves the historical rate correction. Existing earned entries
                  remain immutable.
                </p>
              )}
            </>
          )}
          {editor?.kind === "supplement" && (
            <p>
              Create a separate correction linked to this locked payroll. Add an itemized
              adjustment, then obtain Manager approval before recording payment. For a deduction,
              reference this record from a later Draft with sufficient earnings.
            </p>
          )}
          {editor?.kind === "adjust" && (
            <>
              <TextField
                required
                label="Adjustment (PHP; negative for deduction)"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <TextField
                label="Original approved payroll # (optional)"
                type="number"
                min="1"
                step="1"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              />
              <p>
                This separate item remains visible to the approving Manager. Total payable cannot be
                negative.
              </p>
            </>
          )}
          {editor &&
            ["rate", "correct_snapshot", "supplement", "adjust", "return"].includes(
              editor.kind,
            ) && (
              <TextField
                required
                label={
                  editor.kind === "correct_snapshot" ? "Evidence and correction reason" : "Reason"
                }
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          {editor?.kind === "submit" && (
            <p>
              Submit this breakdown for Manager approval. Return it to Draft before adding services
              or adjustments.
            </p>
          )}
          {editor?.kind === "approve" && (
            <p>
              Approve and lock the full breakdown, including all adjustments. This records your
              Manager identity and approval time.
            </p>
          )}
          {editor?.kind === "pay" && (
            <>
              <p>
                Record a full payment already made outside Barracks. This does not transfer money.
              </p>
              <SelectField
                label="Payment method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="e_wallet">E-wallet</option>
              </SelectField>
              <TextField
                label="Payment time (Manila; blank for now)"
                type="datetime-local"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
              <TextField
                label="Reference (optional)"
                maxLength={160}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={saving}
              onClick={() => setEditor(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !branch}>
              {saving
                ? "Saving…"
                : editor?.kind === "approve"
                  ? "Approve and lock"
                  : editor?.kind === "pay"
                    ? "Confirm paid"
                    : "Confirm"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const avatarTones = ["accent", "blue", "green", "amber"] as const;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
const toneFor = (name: string) =>
  avatarTones[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % avatarTones.length];

function CorrectionApprovals({ corrections }: { corrections: PayrollOverview["corrections"] }) {
  const [expanded, setExpanded] = useState(false);
  const first = corrections[0];
  // Bulk confirmations share one approval and reason; show them once instead of on every row.
  const sharedReason = corrections.every((c) => c.reason === first.reason);
  const sharedApproval = corrections.every(
    (c) => c.approver_name === first.approver_name && c.approved_at === first.approved_at,
  );
  const visible = expanded ? corrections : corrections.slice(0, 6);
  return (
    <Panel className="payroll-corrections">
      <div className="payroll-section-head">
        <h2>
          Historical correction approvals{" "}
          <span className="payroll-count">{corrections.length}</span>
        </h2>
        {sharedApproval && (
          <span className="payroll-period">
            Approved by {first.approver_name} · {dateTime(first.approved_at)}
          </span>
        )}
      </div>
      {sharedReason && <p className="payroll-correction-note">{first.reason}</p>}
      <ul className="payroll-corrections-list">
        {visible.map((c) => (
          <li key={c.id}>
            <span className="payroll-avatar" data-tone={toneFor(c.barber_name)} aria-hidden="true">
              {initials(c.barber_name)}
            </span>
            <div className="payroll-correction-body">
              <strong>{c.barber_name}</strong>
              <span>
                {c.service_name} · Completed {dateTime(c.completed_at)}
              </span>
              {!sharedApproval && (
                <small>
                  Approved by {c.approver_name} · {dateTime(c.approved_at)}
                </small>
              )}
              {!sharedReason && <p>{c.reason}</p>}
            </div>
            <span className="payroll-rate" aria-label={`Commission rate ${c.rate}%`}>
              {c.rate}%
            </span>
          </li>
        ))}
      </ul>
      {corrections.length > 6 && (
        <div className="payroll-corrections-more">
          <Button
            variant="ghost"
            size="sm"
            iconAfter={expanded ? undefined : "chevronRight"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show fewer" : `Show all ${corrections.length}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function PayrollSlip({ detail }: { detail: PayrollDetail }) {
  const { record, entries, adjustments, payment } = detail;
  return (
    <>
      <h2>
        {record.status === "paid" ? "Payslip" : "Payroll breakdown"} #{record.id}
      </h2>
      <p>
        <strong>
          {record.branch_name} · {record.barber_name}
        </strong>
      </p>
      <p>
        {record.period_start} through {lastDay(record.period_end_exclusive)} ·{" "}
        {statusLabel(record.status)}
        {record.supplemental_to && ` · Supplement to #${record.supplemental_to}`}
      </p>
      <dl className="payroll-totals">
        <div>
          <dt>Eligible services</dt>
          <dd>{record.service_count}</dd>
        </div>
        <div>
          <dt>Gross commission</dt>
          <dd>{payrollMoney(record.gross_centavos)}</dd>
        </div>
        <div>
          <dt>Adjustments</dt>
          <dd>{payrollMoney(record.adjustments_centavos)}</dd>
        </div>
        <div>
          <dt>Total payable</dt>
          <dd>{payrollMoney(record.payable_centavos)}</dd>
        </div>
        <div>
          <dt>Total paid</dt>
          <dd>{payrollMoney(payment?.amount_centavos ?? "0")}</dd>
        </div>
        <div>
          <dt>Manager approval</dt>
          <dd>
            {record.approver_name
              ? `${record.approver_name} · ${dateTime(record.approved_at!)}`
              : "Pending"}
          </dd>
        </div>
      </dl>
      {payment && (
        <p>
          Paid {dateTime(payment.paid_at)} · {statusLabel(payment.payment_method)}
          {payment.reference && ` · Reference: ${payment.reference}`} · Recorded by{" "}
          {payment.recorder_name}
        </p>
      )}
      <h3>Service commission breakdown</h3>
      <ResponsiveTable
        className="payroll-services-table"
        headers={[
          "Service / source",
          "Completed / earned (Manila)",
          "Original price",
          "Snapped rate",
          "Commission",
        ]}
      >
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>
              {entry.service_name}
              <small>
                {entry.reference} · {entry.visit_type} #{entry.visit_record_id} ·{" "}
                {statusLabel(entry.transaction_status)}
              </small>
            </td>
            <td>
              {dateTime(entry.completed_at)}
              <small>Earned: {dateTime(entry.earned_at)}</small>
            </td>
            <td>{payrollMoney(entry.original_price_centavos)}</td>
            <td>{entry.rate_snapshot}%</td>
            <td>{payrollMoney(entry.amount_centavos)}</td>
          </tr>
        ))}
      </ResponsiveTable>
      {adjustments.length > 0 && (
        <>
          <h3>Itemized adjustments</h3>
          <ul>
            {adjustments.map((item) => (
              <li key={item.id}>
                <strong>{payrollMoney(item.amount_centavos)}</strong> · {item.reason}
                {item.source_record_id && ` · Correction of payroll #${item.source_record_id}`}
                <small>
                  {item.actor_name} · {dateTime(item.created_at)}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="payroll-footnote">
        Commission uses original service prices before discounts. Earned commission remains after
        refunds. All dates and times are Asia/Manila.
      </p>
    </>
  );
}
