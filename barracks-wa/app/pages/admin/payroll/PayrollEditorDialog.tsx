"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal, SelectField, TextField } from "@/app/components/ui";
import { errorMessage } from "@/app/lib/api";
import { dateTime, payrollMoney } from "@/app/utils/payroll";
import { editorTitles, payrollRequest, type Editor } from "./shared";

export function PayrollEditorDialog({
  editor,
  branchId,
  period,
  anchorDate,
  onClose,
  onSaved,
}: {
  editor: Editor;
  branchId: number;
  period: string;
  anchorDate?: string;
  onClose: () => void;
  onSaved: (result: { message: string; recordId?: string }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [value, setValue] = useState(
    editor.kind === "rate"
      ? (editor.barber.current_rate ?? "")
      : editor.kind === "generate"
        ? period
        : "",
  );
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [sourceId, setSourceId] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
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
      onSaved(result);
    } catch (cause) {
      setFormError(errorMessage(cause, "Unable to save payroll"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={editorTitles[editor.kind]}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className="modal-form" onSubmit={save}>
        {"record" in editor && (
          <p>
            {editor.record.barber_name} · {editor.record.branch_name} · Payable{" "}
            {payrollMoney(editor.record.payable_centavos)}
          </p>
        )}
        {editor.kind === "configure" && (
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
        {editor.kind === "generate" && (
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
            <small>Calendar anchor: {anchorDate}. Ends 14 days after the selected start.</small>
          </>
        )}
        {(editor.kind === "rate" || editor.kind === "correct_snapshot") && (
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
        {editor.kind === "supplement" && (
          <p>
            Create a separate correction linked to this locked payroll. Add an itemized adjustment,
            then obtain Manager approval before recording payment. For a deduction, reference this
            record from a later Draft with sufficient earnings.
          </p>
        )}
        {editor.kind === "adjust" && (
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
        {["rate", "correct_snapshot", "supplement", "adjust", "return"].includes(editor.kind) && (
          <TextField
            required
            label={editor.kind === "correct_snapshot" ? "Evidence and correction reason" : "Reason"}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {editor.kind === "submit" && (
          <p>
            Submit this breakdown for Manager approval. Return it to Draft before adding services or
            adjustments.
          </p>
        )}
        {editor.kind === "approve" && (
          <p>
            Approve and lock the full breakdown, including all adjustments. This records your
            Manager identity and approval time.
          </p>
        )}
        {editor.kind === "pay" && (
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
          <Button variant="secondary" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? "Saving…"
              : editor.kind === "approve"
                ? "Approve and lock"
                : editor.kind === "pay"
                  ? "Confirm paid"
                  : "Confirm"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
