"use client";

import { useRef } from "react";
import { Button, Panel } from "@/app/components/ui";
import type { ApiRole } from "@/app/lib/api";
import type { PayrollDetail } from "@/app/types/payroll";
import { dateTime, statusLabel } from "@/app/utils/payroll";
import { PayrollSlip } from "./PayrollPanels";
import { Status, type Editor } from "./shared";

export function PayrollRecordDetail({
  detail,
  currentUserRole,
  onBack,
  onEdit: edit,
}: {
  detail: PayrollDetail;
  currentUserRole: ApiRole;
  onBack: () => void;
  onEdit: (editor: Editor) => void;
}) {
  const slip = useRef<HTMLDivElement>(null);
  function download() {
    if (!slip.current || detail.record.status !== "paid") return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Barracks payslip</title><style>body{font:14px Arial,sans-serif;margin:32px;color:#17202a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}dl{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}dt{font-weight:bold}dd{margin:4px 0}small{display:block}</style></head><body>${slip.current.innerHTML}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip-${detail.record.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="payroll-detail-actions">
        <Button variant="secondary" onClick={onBack}>
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
        {["approved", "paid"].includes(detail.record.status) && !detail.record.supplemental_to && (
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
  );
}
