export type RestockItem = {
  id: number;
  inventoryItemId: number;
  itemName: string;
  branch: string;
  requestedQuantity: number;
  deliveredQuantity: number | null;
  unitCost: number | string | null;
};
export type Restock = {
  id: number;
  supplier_id: number;
  supplier_name: string;
  status: "Pending" | "Accepted" | "Preparing" | "Shipped" | "Delivered" | "Received" | "Cancelled";
  branch: string;
  reference: string | null;
  notes: string;
  created_at: string;
  received_at: string | null;
  items: RestockItem[];
};
export type DraftLine = {
  key: number;
  inventoryItemId: string;
  quantity: string;
  unitCost: string;
};
export type CreateForm = {
  supplierId: string;
  branch: string;
  items: DraftLine[];
  reference: string;
  notes: string;
};
export type ReceiveLine = { id: number; deliveredQuantity: string; unitCost: string };
export const emptyCreate: CreateForm = {
  supplierId: "",
  branch: "",
  items: [{ key: 1, inventoryItemId: "", quantity: "1", unitCost: "" }],
  reference: "",
  notes: "",
};
export function statusTone(status: Restock["status"]): "success" | "warning" | "danger" | "info" {
  return status === "Received"
    ? "success"
    : status === "Cancelled"
      ? "danger"
      : status === "Delivered"
        ? "info"
        : "warning";
}
export const stages = [
  {
    id: "all",
    label: "All active",
    statuses: ["Pending", "Accepted", "Preparing", "Shipped", "Delivered"],
  },
  { id: "receive", label: "Ready to receive", statuses: ["Delivered"] },
  { id: "arrival", label: "In transit", statuses: ["Shipped"] },
  { id: "supplier", label: "With supplier", statuses: ["Pending", "Accepted", "Preparing"] },
];
