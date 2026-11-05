"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal, TextField } from "@/app/components/ui";
import {
  apiErrorMessage,
  apiRequest,
  errorMessage,
  readApiBody,
  type ApiInventoryItem,
} from "@/app/lib/api";
import { parsePositiveInt } from "./model";

export function RestockDialog({
  item,
  branchId,
  onClose,
  onSubmitted,
}: {
  item: ApiInventoryItem;
  branchId: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const target = item.maximumStock ?? Math.max(item.minimumStock * 2, item.quantity + 1);
  const [quantity, setQuantity] = useState(String(Math.max(1, target - item.quantity)));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitRestock(event: FormEvent) {
    event.preventDefault();
    if (!item.supplierId) return;
    setSubmitting(true);
    setError("");
    try {
      const requestedQuantity = parsePositiveInt(quantity, "Requested quantity");
      const response = await apiRequest(`/api/restocks?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify({
          supplierId: item.supplierId,
          branch: item.branch,
          reference: null,
          notes: notes.trim(),
          items: [{ inventoryItemId: item.id, requestedQuantity, unitCost: item.unitCost }],
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(apiErrorMessage(body, "Unable to create restock request"));
      onSubmitted();
    } catch (error) {
      setError(errorMessage(error, "Unable to create restock request"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Request restock · ${item.name}`} onClose={() => !submitting && onClose()}>
      <form className="modal-form" onSubmit={submitRestock}>
        <p className="form-hint">
          Supplier: {item.supplierName ?? "Assigned supplier"} · Branch: {item.branch} · Current
          stock: {item.quantity} {item.unit}
        </p>
        <TextField
          required
          label="Requested quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional restock notes"
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
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
