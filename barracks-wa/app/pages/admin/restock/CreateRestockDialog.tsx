"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal, SelectField, TextField } from "@/app/components/ui";
import {
  apiErrorMessage,
  apiRequest,
  errorMessage,
  readApiBody,
  type ApiInventoryItem,
  type ApiSupplier,
} from "@/app/lib/api";
import { emptyCreate, type CreateForm, type DraftLine } from "./model";

export function CreateRestockDialog({
  branchId,
  branchName,
  suppliers,
  inventory,
  onToast,
  onClose,
  onCreated,
}: {
  branchId: number;
  branchName: string;
  suppliers: ApiSupplier[];
  inventory: ApiInventoryItem[];
  onToast: (message: string) => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [createForm, setCreateForm] = useState<CreateForm>(() => ({
    ...emptyCreate,
    branch: branchName,
    items: [{ ...emptyCreate.items[0], key: Date.now() }],
  }));
  const [creating, setCreating] = useState(false);

  function itemsForLine(lineKey: number) {
    const selectedElsewhere = new Set(
      createForm.items
        .filter((line) => line.key !== lineKey)
        .map((line) => Number(line.inventoryItemId)),
    );
    return inventory.filter(
      (item) =>
        item.status === "active" &&
        item.supplierId === Number(createForm.supplierId) &&
        item.branch === createForm.branch &&
        !selectedElsewhere.has(item.id),
    );
  }
  function updateLine(key: number, patch: Partial<DraftLine>) {
    setCreateForm((current) => ({
      ...current,
      items: current.items.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }
  function chooseItem(key: number, value: string) {
    const item = inventory.find((candidate) => candidate.id === Number(value));
    updateLine(key, { inventoryItemId: value, unitCost: item ? String(item.unitCost) : "" });
  }
  async function createRestock(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const supplierId = Number(createForm.supplierId);
      if (!supplierId || !createForm.branch) throw new Error("Choose a supplier and branch");
      const items = createForm.items.map((line) => {
        const quantity = Number(line.quantity);
        const unitCost = line.unitCost.trim() ? Number(line.unitCost) : null;
        if (!Number.isInteger(Number(line.inventoryItemId)) || Number(line.inventoryItemId) <= 0)
          throw new Error("Choose an inventory item for every line");
        if (!Number.isInteger(quantity) || quantity <= 0)
          throw new Error("Requested quantities must be positive whole numbers");
        if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0))
          throw new Error("Unit costs must be non-negative amounts");
        return {
          inventoryItemId: Number(line.inventoryItemId),
          requestedQuantity: quantity,
          unitCost,
        };
      });
      if (new Set(items.map((item) => item.inventoryItemId)).size !== items.length)
        throw new Error("An item can only appear once per request");
      const response = await apiRequest(`/api/restocks?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branch: createForm.branch,
          reference: createForm.reference.trim() || null,
          notes: createForm.notes.trim(),
          items,
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(apiErrorMessage(body, "Unable to create restock request"));
      onCreated();
    } catch (error) {
      onToast(errorMessage(error, "Unable to create restock request"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open title="Create restock request" onClose={() => !creating && onClose()}>
      <form className="modal-form" onSubmit={createRestock}>
        <SelectField
          required
          label="Supplier"
          value={createForm.supplierId}
          onChange={(event) =>
            setCreateForm({
              ...createForm,
              supplierId: event.target.value,
              branch: branchName,
              items: [{ key: Date.now(), inventoryItemId: "", quantity: "1", unitCost: "" }],
            })
          }
        >
          <option value="">Choose supplier</option>
          {suppliers
            .filter((supplier) => supplier.status === "active")
            .map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.companyName}
              </option>
            ))}
        </SelectField>
        <TextField label="Branch" value={branchName} readOnly />
        <div className="modal-form__section">
          <div className="section-heading">
            <div>
              <h3>Request items</h3>
              <p className="form-hint">Items are limited to this supplier and branch.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={() =>
                setCreateForm((current) => ({
                  ...current,
                  items: [
                    ...current.items,
                    {
                      key: Date.now() + current.items.length,
                      inventoryItemId: "",
                      quantity: "1",
                      unitCost: "",
                    },
                  ],
                }))
              }
            >
              Add item
            </Button>
          </div>
          {createForm.supplierId &&
            !inventory.some(
              (item) =>
                item.status === "active" &&
                item.supplierId === Number(createForm.supplierId) &&
                item.branch === createForm.branch,
            ) && (
              <p className="form-error" role="status">
                No items in this branch are assigned to this supplier yet. Open Suppliers, choose
                this supplier, and use Assign items.
              </p>
            )}
          {createForm.items.map((line, index) => (
            <div className="form-grid form-grid--three" key={line.key}>
              <SelectField
                required
                label={`Item ${index + 1}`}
                value={line.inventoryItemId}
                onChange={(event) => chooseItem(line.key, event.target.value)}
              >
                <option value="">Choose item</option>
                {itemsForLine(line.key).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.quantity} {item.unit}
                  </option>
                ))}
              </SelectField>
              <TextField
                required
                label="Quantity"
                type="number"
                min="1"
                step="1"
                value={line.quantity}
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
              />
              <TextField
                label="Expected unit cost"
                type="number"
                min="0"
                step="0.01"
                value={line.unitCost}
                onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
              />
            </div>
          ))}
        </div>
        <TextField
          label="Reference"
          value={createForm.reference}
          onChange={(event) => setCreateForm({ ...createForm, reference: event.target.value })}
        />
        <TextField
          label="Notes"
          value={createForm.notes}
          onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })}
        />
        <div className="modal-actions">
          <Button type="button" variant="secondary" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={creating}>
            {creating ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
