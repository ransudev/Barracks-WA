"use client";

import { useState } from "react";
import { Button, Panel } from "@/app/components/ui";
import { ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import type { PayrollDetail, PayrollOverview } from "@/app/types/payroll";
import { dateTime, lastDay, payrollMoney, statusLabel } from "@/app/utils/payroll";

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

export function CorrectionApprovals({
  corrections,
}: {
  corrections: PayrollOverview["corrections"];
}) {
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
