import type { ApiInventoryItem } from "@/app/lib/api";

export type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock" | "inactive";
export type ViewMode = "cards" | "table";
export type SortKey =
  "name" | "sku" | "supplier" | "quantity" | "threshold" | "unitCost" | "status";
export type SortDirection = "asc" | "desc";
export type MovementType =
  | "RECEIVE"
  | "USE"
  | "CUSTOMER_PURCHASE"
  | "STAFF_USAGE"
  | "DAMAGE"
  | "DISCARD"
  | "RETURN"
  | "ADJUSTMENT";

export type ItemForm = {
  name: string;
  category: ApiInventoryItem["category"];
  branch: string;
  initialQuantity: string;
  minimumStock: string;
  maximumStock: string;
  unitCost: string;
  unit: string;
  sku: string;
  supplierId: string;
  status: "active" | "inactive";
  imageUrl: string;
  stockReason: string;
};

export type MovementForm = {
  movementType: MovementType;
  quantity: string;
  unitCost: string;
  reference: string;
  notes: string;
  adjustmentDirection: "increase" | "decrease";
  countedStock: string;
};

export type Movement = {
  id: number;
  movement_type: MovementType;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reference: string | null;
  notes: string;
  created_by_name: string;
  branch: string;
  created_at: string;
};

export const emptyForm: ItemForm = {
  name: "",
  category: "Supplies",
  branch: "Main Branch",
  initialQuantity: "0",
  minimumStock: "10",
  maximumStock: "",
  unitCost: "0",
  unit: "unit",
  sku: "",
  supplierId: "",
  status: "active",
  imageUrl: "",
  stockReason: "",
};

export const emptyMovement: MovementForm = {
  movementType: "STAFF_USAGE",
  quantity: "1",
  unitCost: "",
  reference: "",
  notes: "",
  adjustmentDirection: "increase",
  countedStock: "",
};

export function stockStatus(item: ApiInventoryItem): StockFilter {
  if (item.status === "inactive") return "inactive";
  if (item.quantity === 0) return "out_of_stock";
  return item.quantity <= item.minimumStock ? "low_stock" : "in_stock";
}

export function stockStatusLabel(status: StockFilter): string {
  return status === "out_of_stock"
    ? "Out of stock"
    : status === "low_stock"
      ? "Low stock"
      : status === "inactive"
        ? "Archived"
        : "In stock";
}

export function statusTone(status: StockFilter): "neutral" | "danger" | "warning" | "success" {
  return status === "out_of_stock"
    ? "danger"
    : status === "low_stock"
      ? "warning"
      : status === "in_stock"
        ? "success"
        : "neutral";
}

export function movementLabel(type: MovementType): string {
  const labels: Record<MovementType, string> = {
    RECEIVE: "Received stock",
    USE: "Used stock",
    CUSTOMER_PURCHASE: "Sold to customer",
    STAFF_USAGE: "Used by barber",
    DAMAGE: "Damaged stock",
    DISCARD: "Discarded stock",
    RETURN: "Returned stock",
    ADJUSTMENT: "Manual adjustment",
  };
  return labels[type];
}

export function parseNumber(value: string, label: string, integer = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < 0) {
    throw new Error(`${label} must be a non-negative ${integer ? "whole number" : "amount"}.`);
  }
  return parsed;
}

export function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive whole number.`);
  return parsed;
}

export function formFromItem(item: ApiInventoryItem): ItemForm {
  return {
    name: item.name,
    category: item.category,
    branch: item.branch,
    initialQuantity: String(item.quantity),
    minimumStock: String(item.minimumStock),
    maximumStock: item.maximumStock === null ? "" : String(item.maximumStock),
    unitCost: String(item.unitCost),
    unit: item.unit,
    sku: item.sku ?? "",
    supplierId: item.supplierId === null ? "" : String(item.supplierId),
    status: item.status,
    imageUrl: item.imageUrl ?? "",
    stockReason: "",
  };
}

export function itemPayload(form: ItemForm, includeQuantity: boolean) {
  const basePayload = {
    name: form.name.trim(),
    category: form.category,
    branch: form.branch.trim() || "Main Branch",
    supplierId: form.supplierId ? Number(form.supplierId) : null,
    unit: form.unit.trim() || "unit",
    sku: form.sku.trim() || null,
    minimumStock: parseNumber(form.minimumStock, "Minimum stock", true),
    maximumStock: form.maximumStock.trim()
      ? parseNumber(form.maximumStock, "Maximum stock", true)
      : null,
    unitCost: parseNumber(form.unitCost, "Unit cost"),
    status: form.status,
    imageUrl: form.imageUrl.trim() || null,
  };
  return includeQuantity
    ? {
        ...basePayload,
        initialQuantity: parseNumber(form.initialQuantity, "Initial quantity", true),
      }
    : basePayload;
}

export function detailsChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  const initial = formFromItem(item);
  return (
    JSON.stringify({ ...initial, initialQuantity: undefined, stockReason: undefined }) !==
    JSON.stringify({ ...form, initialQuantity: undefined, stockReason: undefined })
  );
}

export function stockChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  return form.initialQuantity.trim() !== "" && Number(form.initialQuantity) !== item.quantity;
}

export function formHasChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  return detailsChanged(item, form) || stockChanged(item, form);
}

// Stock moves in or out by operation; manual corrections are entered as the counted total.
export const stockIn: MovementType[] = ["RECEIVE", "RETURN"];
export function movementDelta(item: ApiInventoryItem, form: MovementForm): number | null {
  if (form.movementType === "ADJUSTMENT") {
    const counted = Number(form.countedStock);
    return form.countedStock.trim() !== "" && Number.isInteger(counted) && counted >= 0
      ? counted - item.quantity
      : null;
  }
  const quantity = Number(form.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  return stockIn.includes(form.movementType) ? quantity : -quantity;
}
