import type { FormEvent } from "react";
import type { ApiInventoryItem } from "@/app/lib/api";
import { Button, SelectField, TextField } from "@/app/components/ui";

export type InventoryFormValue = {
  name: string;
  category: ApiInventoryItem["category"];
  quantity: string;
  minimumStock: string;
  unitCost: string;
};

export const emptyInventoryForm: InventoryFormValue = {
  name: "",
  category: "Supplies",
  quantity: "0",
  minimumStock: "10",
  unitCost: "0",
};

export function InventoryForm({
  value,
  editing = false,
  submitting = false,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
}: {
  value: InventoryFormValue;
  editing?: boolean;
  submitting?: boolean;
  onChange: (value: InventoryFormValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form className="modal-form" onSubmit={onSubmit}>
      <TextField
        label="Item name"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        placeholder="e.g. Neck strips"
      />
      <div className="form-grid form-grid--three">
        <SelectField
          label="Category"
          value={value.category}
          onChange={(event) =>
            onChange({ ...value, category: event.target.value as InventoryFormValue["category"] })
          }
        >
          <option>Supplies</option>
          <option>Equipment</option>
          <option>Products</option>
        </SelectField>
        <TextField
          label="Quantity"
          type="number"
          min="0"
          value={value.quantity}
          onChange={(event) => onChange({ ...value, quantity: event.target.value })}
        />
        <TextField
          label="Minimum stock"
          type="number"
          min="0"
          value={value.minimumStock}
          onChange={(event) => onChange({ ...value, minimumStock: event.target.value })}
        />
      </div>
      <TextField
        label="Unit cost"
        type="number"
        min="0"
        step="0.01"
        value={value.unitCost}
        onChange={(event) => onChange({ ...value, unitCost: event.target.value })}
      />
      <div className="modal-actions">
        <Button variant="secondary" type="button" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        {editing && onDelete && (
          <Button variant="danger" type="button" disabled={submitting} onClick={onDelete}>
            Delete
          </Button>
        )}
        <Button type="submit" icon="check" disabled={submitting}>
          {submitting ? "Saving…" : "Save item"}
        </Button>
      </div>
    </form>
  );
}
