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
import { ItemPhotoField } from "./ItemPhotoField";
import { emptyForm, itemPayload, type ItemForm } from "./model";

export function AddItemDialog({
  branchId,
  branchName,
  suppliers,
  onClose,
  onSaved,
}: {
  branchId: number;
  branchName: string;
  suppliers: ApiSupplier[];
  onClose: () => void;
  onSaved: (item: ApiInventoryItem) => void;
}) {
  const [form, setForm] = useState<ItemForm>({ ...emptyForm, branch: branchName });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  function close() {
    if (!submitting) onClose();
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      if (!form.name.trim()) throw new Error("Item name is required.");
      const response = await apiRequest(`/api/inventory?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify(itemPayload(form, true)),
      });
      const body = await readApiBody<{
        success: boolean;
        item?: ApiInventoryItem;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.item)
        throw new Error(apiErrorMessage(body, "Unable to add inventory item"));
      onSaved(body.item);
    } catch (error) {
      setFormError(errorMessage(error, "Unable to add inventory item"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title="Add inventory item"
      description="Create a trackable item for the selected branch."
      onClose={close}
    >
      <form className="modal-form" onSubmit={saveItem}>
        <TextField
          label="Item name"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <ItemPhotoField
          value={form.imageUrl}
          disabled={submitting}
          onChange={(imageUrl) => setForm({ ...form, imageUrl })}
        />
        <div className="form-grid form-grid--three">
          <SelectField
            label="Category"
            required
            value={form.category}
            onChange={(event) =>
              setForm({ ...form, category: event.target.value as ItemForm["category"] })
            }
          >
            <option>Supplies</option>
            <option>Equipment</option>
            <option>Products</option>
          </SelectField>
          <TextField label="Branch" value={form.branch} readOnly />
          <TextField
            label="Unit"
            required
            value={form.unit}
            onChange={(event) => setForm({ ...form, unit: event.target.value })}
          />
        </div>
        <TextField
          label="SKU"
          value={form.sku}
          onChange={(event) => setForm({ ...form, sku: event.target.value })}
        />
        <SelectField
          label="Supplier"
          value={form.supplierId}
          onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
        >
          <option value="">No supplier</option>
          {suppliers
            .filter((supplier) => supplier.status === "active")
            .map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.companyName}
              </option>
            ))}
        </SelectField>
        <div className="form-grid form-grid--three">
          <TextField
            label="Initial quantity"
            required
            type="number"
            min="0"
            step="1"
            value={form.initialQuantity}
            onChange={(event) => setForm({ ...form, initialQuantity: event.target.value })}
          />
          <TextField
            label="Minimum stock"
            required
            type="number"
            min="0"
            step="1"
            value={form.minimumStock}
            onChange={(event) => setForm({ ...form, minimumStock: event.target.value })}
          />
          <TextField
            label="Maximum stock"
            type="number"
            min="0"
            step="1"
            value={form.maximumStock}
            onChange={(event) => setForm({ ...form, maximumStock: event.target.value })}
          />
        </div>
        <div className="form-grid">
          <TextField
            label="Unit cost"
            required
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(event) => setForm({ ...form, unitCost: event.target.value })}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(event) =>
              setForm({ ...form, status: event.target.value as ItemForm["status"] })
            }
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </SelectField>
        </div>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" disabled={submitting} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" icon="check" disabled={submitting}>
            {submitting ? "Saving…" : "Save item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
