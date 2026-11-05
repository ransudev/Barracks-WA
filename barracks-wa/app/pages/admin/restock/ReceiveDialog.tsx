"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal, TextField } from "@/app/components/ui";
import { apiRequest, errorMessage, readApiBody } from "@/app/lib/api";
import type { ReceiveLine, Restock } from "./model";

export function ReceiveDialog({
  restock,
  branchId,
  onToast,
  onClose,
  onReceived,
}: {
  restock: Restock;
  branchId: number;
  onToast: (message: string) => void;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [lines, setLines] = useState<ReceiveLine[]>(() =>
    restock.items.map((item) => ({
      id: item.id,
      deliveredQuantity: String(item.requestedQuantity),
      unitCost: item.unitCost === null || item.unitCost === undefined ? "" : String(item.unitCost),
    })),
  );
  const [reference, setReference] = useState(restock.reference ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function receive(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const items = lines.map((line) => {
        const deliveredQuantity = Number(line.deliveredQuantity);
        const unitCost = line.unitCost.trim() ? Number(line.unitCost) : null;
        if (!Number.isInteger(deliveredQuantity) || deliveredQuantity < 0)
          throw new Error("Delivered quantities must be whole numbers");
        if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0))
          throw new Error("Unit costs must be non-negative amounts");
        return { restockRequestItemId: line.id, deliveredQuantity, unitCost };
      });
      const response = await apiRequest(
        `/api/restocks/${restock.id}/receive?branchId=${branchId}`,
        {
          method: "POST",
          body: JSON.stringify({
            reference: reference.trim() || null,
            notes: notes.trim(),
            items,
          }),
        },
      );
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to receive delivery");
      onReceived();
    } catch (error) {
      onToast(errorMessage(error, "Unable to receive delivery"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Receive request #${restock.id}`} onClose={() => !submitting && onClose()}>
      <form className="modal-form" onSubmit={receive}>
        {restock.items.map((item) => {
          const line = lines.find((entry) => entry.id === item.id);
          return (
            <div className="form-grid form-grid--two" key={item.id}>
              <TextField
                label={`${item.itemName} delivered`}
                type="number"
                min="0"
                step="1"
                value={line?.deliveredQuantity ?? "0"}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, deliveredQuantity: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <TextField
                label="Unit cost"
                type="number"
                min="0"
                step="0.01"
                value={line?.unitCost ?? ""}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((entry) =>
                      entry.id === item.id ? { ...entry, unitCost: event.target.value } : entry,
                    ),
                  )
                }
              />
            </div>
          );
        })}
        <TextField
          label="Reference number"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
        <TextField label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <p className="form-hint">
          Receiving updates every line transactionally and cannot be repeated.
        </p>
        <div className="modal-actions">
          <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Receiving…" : "Confirm receiving"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
