"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal, SelectField, TextField } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import {
  apiErrorMessage,
  apiRequest,
  errorMessage,
  readApiBody,
  type ApiInventoryItem,
} from "@/app/lib/api";
import {
  emptyMovement,
  movementDelta,
  movementLabel,
  parseNumber,
  parsePositiveInt,
  stockIn,
  type MovementForm,
  type MovementType,
} from "./model";

export function MovementDialog({
  item,
  initialType,
  branchId,
  onClose,
  onRecorded,
}: {
  item: ApiInventoryItem;
  initialType: MovementType;
  branchId: number;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const [form, setForm] = useState<MovementForm>({
    ...emptyMovement,
    movementType: initialType,
    countedStock: String(item.quantity),
    unitCost: initialType === "RECEIVE" ? String(item.unitCost) : "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (form.movementType === "ADJUSTMENT" && !form.notes.trim())
        throw new Error("A reason is required for manual adjustments.");
      const delta = movementDelta(item, form);
      if (form.movementType === "ADJUSTMENT") {
        if (delta === null)
          throw new Error("Enter the actual count as a whole number of 0 or more.");
        if (delta === 0)
          throw new Error(
            `The count matches the current stock of ${item.quantity}. Nothing to adjust.`,
          );
      }
      if (delta !== null && item.quantity + delta < 0)
        throw new Error(
          `Only ${item.quantity} ${item.unit} in stock. You cannot remove more than that.`,
        );
      const payload = {
        movementType: form.movementType,
        quantity:
          form.movementType === "ADJUSTMENT"
            ? Math.abs(delta ?? 0)
            : parsePositiveInt(form.quantity, "Quantity"),
        supplierId: item.supplierId,
        unitCost: form.unitCost.trim() ? parseNumber(form.unitCost, "Unit cost") : null,
        reference: form.reference.trim() || null,
        notes: form.notes.trim(),
        ...(form.movementType === "ADJUSTMENT"
          ? { adjustmentDirection: (delta ?? 0) > 0 ? "increase" : "decrease" }
          : {}),
      };
      const response = await apiRequest(
        `/api/inventory/${item.id}/movements?branchId=${branchId}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      const body = await readApiBody<{
        success: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(apiErrorMessage(body, "Unable to record stock operation"));
      onRecorded(
        `${movementLabel(form.movementType)} recorded · ${item.name} now ${item.quantity + (delta ?? 0)} ${item.unit}`,
      );
    } catch (error) {
      setError(errorMessage(error, "Unable to record stock operation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Stock operation · ${item.name}`} onClose={() => !submitting && onClose()}>
      <form className="modal-form" onSubmit={submitMovement}>
        <SelectField
          label="Operation"
          value={form.movementType}
          onChange={(event) =>
            setForm({ ...form, movementType: event.target.value as MovementType })
          }
        >
          <optgroup label="Add to stock">
            <option value="RECEIVE">Receive stock</option>
            <option value="RETURN">Returned to shelf</option>
          </optgroup>
          <optgroup label="Remove from stock">
            {(item.category === "Products" || item.category === "Supplies") && (
              <option value="CUSTOMER_PURCHASE">Sold to customer</option>
            )}
            {(item.category === "Products" || item.category === "Supplies") && (
              <option value="STAFF_USAGE">Used by barber</option>
            )}
            <option value="DAMAGE">Damaged stock</option>
            <option value="DISCARD">Discard stock</option>
          </optgroup>
          <optgroup label="Correct the count">
            <option value="ADJUSTMENT">Set actual count</option>
          </optgroup>
        </SelectField>
        {form.movementType === "ADJUSTMENT" ? (
          <TextField
            required
            label={`Actual count on hand (${item.unit})`}
            type="number"
            min="0"
            step="1"
            value={form.countedStock}
            onChange={(event) => setForm({ ...form, countedStock: event.target.value })}
          />
        ) : (
          <TextField
            required
            label={stockIn.includes(form.movementType) ? "Quantity to add" : "Quantity to remove"}
            type="number"
            min="1"
            step="1"
            value={form.quantity}
            onChange={(event) => setForm({ ...form, quantity: event.target.value })}
          />
        )}
        {(() => {
          const delta = movementDelta(item, form);
          const next = delta === null ? null : item.quantity + delta;
          return (
            <p
              className={`stock-preview ${next !== null && next < 0 ? "is-invalid" : ""}`}
              aria-live="polite"
            >
              <span>
                Current <strong>{item.quantity}</strong>
              </span>
              <Icon name="arrowRight" size={14} />
              <span>
                After <strong>{next ?? "—"}</strong> {item.unit}
              </span>
              {delta !== null && delta !== 0 && (
                <em className={delta > 0 ? "is-up" : "is-down"}>
                  {delta > 0 ? `+${delta}` : delta}
                </em>
              )}
            </p>
          );
        })()}
        {(form.movementType === "RECEIVE" || form.movementType === "RETURN") && (
          <TextField
            label="Unit cost"
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(event) => setForm({ ...form, unitCost: event.target.value })}
          />
        )}
        <TextField
          label="Reference"
          value={form.reference}
          onChange={(event) => setForm({ ...form, reference: event.target.value })}
          placeholder="PO, delivery receipt, sale or service ref"
        />
        <TextField
          label={form.movementType === "ADJUSTMENT" ? "Reason" : "Notes"}
          required={form.movementType === "ADJUSTMENT"}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          placeholder={
            form.movementType === "STAFF_USAGE"
              ? "Barber, service, or purpose"
              : form.movementType === "CUSTOMER_PURCHASE"
                ? "Sale or receipt reference"
                : undefined
          }
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Recording…" : "Record operation"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
