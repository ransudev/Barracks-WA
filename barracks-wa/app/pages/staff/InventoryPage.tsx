"use client";
import { ListPageSkeleton } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";

/* Inventory photos are user-supplied data URLs, which next/image cannot resize
   or cache, so plain img tags are the right fit for this screen. */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, peekApiBody, readApiBody } from "@/app/lib/api";
import { useBodyScrollLock } from "@/app/hooks/useBodyScrollLock";
import { useDrawerPresence } from "@/app/hooks/useDrawerPresence";
import { downloadCsv } from "@/app/utils/download";
import { formatCurrency } from "@/app/utils/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  MetricCard,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { ViewToggle as OperationalViewToggle } from "@/app/components/operations/OperationalPrimitives";

type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock" | "inactive";
type ViewMode = "cards" | "table";
type SortKey = "name" | "sku" | "supplier" | "quantity" | "threshold" | "unitCost" | "status";
type SortDirection = "asc" | "desc";
type MovementType =
  | "RECEIVE"
  | "USE"
  | "CUSTOMER_PURCHASE"
  | "STAFF_USAGE"
  | "DAMAGE"
  | "DISCARD"
  | "RETURN"
  | "ADJUSTMENT";

type ItemForm = {
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

type MovementForm = {
  movementType: MovementType;
  quantity: string;
  unitCost: string;
  reference: string;
  notes: string;
  adjustmentDirection: "increase" | "decrease";
  countedStock: string;
};

type Movement = {
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

const emptyForm: ItemForm = {
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

const emptyMovement: MovementForm = {
  movementType: "STAFF_USAGE",
  quantity: "1",
  unitCost: "",
  reference: "",
  notes: "",
  adjustmentDirection: "increase",
  countedStock: "",
};

function stockStatus(item: ApiInventoryItem): StockFilter {
  if (item.status === "inactive") return "inactive";
  if (item.quantity === 0) return "out_of_stock";
  return item.quantity <= item.minimumStock ? "low_stock" : "in_stock";
}

function stockStatusLabel(status: StockFilter): string {
  return status === "out_of_stock"
    ? "Out of stock"
    : status === "low_stock"
      ? "Low stock"
      : status === "inactive"
        ? "Archived"
        : "In stock";
}

function statusTone(status: StockFilter): "neutral" | "danger" | "warning" | "success" {
  return status === "out_of_stock"
    ? "danger"
    : status === "low_stock"
      ? "warning"
      : status === "in_stock"
        ? "success"
        : "neutral";
}

function ProductImagePlaceholder() {
  return (
    <span className="product-image-placeholder" aria-hidden="true">
      <svg viewBox="0 0 200 150" focusable="false">
        <rect
          x="10"
          y="10"
          width="180"
          height="130"
          rx="11"
          fill="#f0f2f5"
          stroke="#9299a1"
          strokeWidth="6"
        />
        <circle cx="146" cy="45" r="17" fill="#9299a1" />
        <path d="M14 136 73 62c2-3 6-3 8 0l48 59 16-19c3-4 7-4 10 0l32 34H14Z" fill="#9299a1" />
        <path
          d="m122 119 13-13"
          fill="none"
          stroke="#f0f2f5"
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
    </span>
  );
}

function movementLabel(type: MovementType): string {
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

function responseMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
): string {
  const validationMessage = body?.errors
    ? Object.values(body.errors).flat().filter(Boolean).join(" ")
    : "";
  return validationMessage || body?.message || fallback;
}

function parseNumber(value: string, label: string, integer = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < 0) {
    throw new Error(`${label} must be a non-negative ${integer ? "whole number" : "amount"}.`);
  }
  return parsed;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive whole number.`);
  return parsed;
}

function formFromItem(item: ApiInventoryItem): ItemForm {
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

function itemPayload(form: ItemForm, includeQuantity: boolean) {
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

function detailsChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  const initial = formFromItem(item);
  return (
    JSON.stringify({ ...initial, initialQuantity: undefined, stockReason: undefined }) !==
    JSON.stringify({ ...form, initialQuantity: undefined, stockReason: undefined })
  );
}

function stockChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  return form.initialQuantity.trim() !== "" && Number(form.initialQuantity) !== item.quantity;
}

function formHasChanged(item: ApiInventoryItem, form: ItemForm): boolean {
  return detailsChanged(item, form) || stockChanged(item, form);
}

// Stock moves in or out by operation; manual corrections are entered as the counted total.
const stockIn: MovementType[] = ["RECEIVE", "RETURN"];
function movementDelta(item: ApiInventoryItem, form: MovementForm): number | null {
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

function StatusBadge({ item }: { item: ApiInventoryItem }) {
  const status = stockStatus(item);
  return <Badge tone={statusTone(status)}>{stockStatusLabel(status)}</Badge>;
}

const MAX_PHOTO_DIMENSION = 720;

function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read that image file"));
    image.src = source;
  });
}

// Photos are down-scaled and re-encoded in the browser so a saved item stays a
// small data URL instead of the original camera file.
async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, or WebP image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(
      1,
      MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight, 1),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to process that image");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/webp", 0.82);
    return encoded.startsWith("data:image/webp") ? encoded : canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ItemPhotoField({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await readImageAsDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to use that image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="item-photo-field">
      <span className="item-photo-field__preview">
        {value ? <img src={value} alt="" /> : <ProductImagePlaceholder />}
      </span>
      <div className="item-photo-field__copy">
        <strong>Product photo</strong>
        <span className="item-photo-field__hint">
          Shown on the inventory card. PNG, JPG, or WebP.
        </span>
        <div className="item-photo-field__actions">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="photo"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Processing…" : value ? "Change photo" : "Add photo"}
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => onChange("")}
            >
              Remove
            </Button>
          )}
        </div>
        {error && (
          <span className="item-photo-field__error" role="alert">
            {error}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        className="item-photo-field__input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={choosePhoto}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

function InventoryCard({
  item,
  onOpen,
  onRestock,
}: {
  item: ApiInventoryItem;
  onOpen: () => void;
  onRestock: () => void;
}) {
  const status = stockStatus(item);

  return (
    <article className={`inventory-card inventory-card--${status}`}>
      <button
        type="button"
        className="inventory-card__main"
        onClick={onOpen}
        aria-label={`Open ${item.name}`}
      >
        <span className="inventory-card__media">
          {item.imageUrl ? (
            <img
              className="inventory-card__photo"
              src={item.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <ProductImagePlaceholder />
          )}
        </span>
        <span className="inventory-card__body">
          <h3>{item.name}</h3>
          <p>{item.sku || "No SKU"}</p>
          <span className="inventory-card__row">
            <StatusBadge item={item} />
            <span className="inventory-card__qty">
              {item.quantity}
              <small>{item.unit}</small>
            </span>
          </span>
        </span>
      </button>
      <div className="inventory-card__footer">
        <span>{item.category}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="stockIn"
          disabled={item.status === "inactive" || !item.supplierId}
          title={
            !item.supplierId
              ? "Assign a supplier to this item first (Edit item or Suppliers page)"
              : undefined
          }
          onClick={onRestock}
        >
          Restock
        </Button>
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="inventory-card-grid" aria-label="Loading inventory" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="inventory-card inventory-card--skeleton" key={index}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function InventoryDrawer({
  open,
  item,
  form,
  editing,
  dirty,
  canDelete,
  saving,
  history,
  historyLoading,
  suppliers,
  onRequestClose,
  onEdit,
  onFormChange,
  onSave,
  onCancelEdit,
  onReceive,
  onUsage,
  onAdjust,
  onDamage,
  onRestock,
  onHistory,
  onDeactivate,
}: {
  open: boolean;
  item: ApiInventoryItem;
  form: ItemForm;
  editing: boolean;
  dirty: boolean;
  canDelete: boolean;
  saving: boolean;
  history: Movement[];
  historyLoading: boolean;
  suppliers: ApiSupplier[];
  onRequestClose: () => void;
  onEdit: () => void;
  onFormChange: (field: keyof ItemForm, value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onReceive: () => void;
  onUsage: () => void;
  onAdjust: () => void;
  onDamage: () => void;
  onRestock: () => void;
  onHistory: () => void;
  onDeactivate: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onRequestCloseRef = useRef(onRequestClose);
  const { mounted, phase } = useDrawerPresence(open);

  useBodyScrollLock(mounted);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!mounted) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [mounted]);

  const disabledActions = item.status === "inactive";

  if (!mounted) return null;

  return (
    <div className="inventory-drawer-layer" role="presentation" data-state={phase}>
      <button
        className="inventory-drawer-scrim"
        type="button"
        aria-label="Close item details"
        onClick={onRequestClose}
      />
      <aside
        className="inventory-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-drawer-title"
      >
        <header className="inventory-drawer__header">
          <div>
            <span className="inventory-kicker">Inventory item</span>
            <h2 id="inventory-drawer-title">{item.name}</h2>
            <p>
              {item.category} · {item.branch}
            </p>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="Close item details"
            title="Close item details"
            onClick={onRequestClose}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="inventory-drawer__body">
          <section className="inventory-drawer__summary">
            <div className="inventory-drawer__identity">
              {item.imageUrl ? (
                <span className="inventory-drawer__photo">
                  <img src={item.imageUrl} alt="" />
                </span>
              ) : (
                <span className="inventory-drawer__photo inventory-drawer__photo--empty">
                  <ProductImagePlaceholder />
                </span>
              )}
              <div>
                <strong>{item.sku || "No SKU assigned"}</strong>
                <span>{item.supplierName || "No supplier assigned"}</span>
              </div>
            </div>
            <StatusBadge item={item} />
          </section>
          <section className="inventory-drawer__section">
            <div className="inventory-drawer__section-heading">
              <div>
                <span className="inventory-kicker">At a glance</span>
                <h3>Stock snapshot</h3>
              </div>
              {!editing && (
                <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
                  Edit item
                </Button>
              )}
            </div>
            <div className="inventory-drawer__metrics">
              <div>
                <span>Current quantity</span>
                <strong>
                  {item.quantity} <small>{item.unit}</small>
                </strong>
              </div>
              <div>
                <span>Inventory value</span>
                <strong>{formatCurrency(item.quantity * item.unitCost)}</strong>
              </div>
              <div>
                <span>Minimum stock</span>
                <strong>
                  {item.minimumStock} <small>{item.unit}</small>
                </strong>
              </div>
              <div>
                <span>Maximum stock</span>
                <strong>{item.maximumStock ?? "—"}</strong>
              </div>
            </div>
          </section>

          {editing ? (
            <form className="inventory-drawer__form" onSubmit={onSave}>
              <div className="inventory-drawer__section-heading">
                <div>
                  <span className="inventory-kicker">Item details</span>
                  <h3>Update details</h3>
                </div>
                <span className="inventory-drawer__dirty">
                  {dirty ? "Unsaved changes" : "No changes"}
                </span>
              </div>
              <TextField
                label="Item name"
                required
                value={form.name}
                onChange={(event) => onFormChange("name", event.target.value)}
              />
              <ItemPhotoField
                value={form.imageUrl}
                disabled={saving}
                onChange={(imageUrl) => onFormChange("imageUrl", imageUrl)}
              />
              <div className="form-grid form-grid--two inventory-drawer__form-grid">
                <SelectField
                  label="Category"
                  required
                  value={form.category}
                  onChange={(event) => onFormChange("category", event.target.value)}
                >
                  <option>Supplies</option>
                  <option>Equipment</option>
                  <option>Products</option>
                </SelectField>
                <TextField
                  label="Unit"
                  required
                  value={form.unit}
                  onChange={(event) => onFormChange("unit", event.target.value)}
                />
              </div>
              <div className="form-grid form-grid--two inventory-drawer__form-grid">
                <TextField
                  label="SKU"
                  value={form.sku}
                  onChange={(event) => onFormChange("sku", event.target.value)}
                />
                <SelectField
                  label="Supplier"
                  value={form.supplierId}
                  onChange={(event) => onFormChange("supplierId", event.target.value)}
                >
                  <option value="">No supplier</option>
                  {suppliers
                    .filter(
                      (supplier) =>
                        supplier.status === "active" || String(supplier.id) === form.supplierId,
                    )
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.companyName}
                      </option>
                    ))}
                </SelectField>
              </div>
              <div className="form-grid form-grid--two inventory-drawer__form-grid">
                <TextField
                  label="Unit cost"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitCost}
                  onChange={(event) => onFormChange("unitCost", event.target.value)}
                />
                <SelectField
                  label="Status"
                  value={form.status}
                  onChange={(event) => onFormChange("status", event.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </SelectField>
              </div>
              <div className="form-grid form-grid--two inventory-drawer__form-grid">
                <TextField
                  label="Minimum stock"
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={form.minimumStock}
                  onChange={(event) => onFormChange("minimumStock", event.target.value)}
                />
                <TextField
                  label="Maximum stock"
                  type="number"
                  min="0"
                  step="1"
                  value={form.maximumStock}
                  onChange={(event) => onFormChange("maximumStock", event.target.value)}
                />
              </div>
              <div className="form-grid form-grid--two inventory-drawer__form-grid">
                <TextField
                  label={`Current stock (${item.unit})`}
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={form.initialQuantity}
                  onChange={(event) => onFormChange("initialQuantity", event.target.value)}
                />
                {stockChanged(item, form) && (
                  <TextField
                    label="Reason for stock change"
                    required
                    value={form.stockReason}
                    placeholder="e.g. Shelf count, found extra stock"
                    onChange={(event) => onFormChange("stockReason", event.target.value)}
                  />
                )}
              </div>
              {stockChanged(item, form) && (
                <p className="form-hint">
                  Stock will change from {item.quantity} to {form.initialQuantity} {item.unit} (
                  {Number(form.initialQuantity) - item.quantity > 0 ? "+" : ""}
                  {Number(form.initialQuantity) - item.quantity}). The change is saved as a manual
                  adjustment in the movement history.
                </p>
              )}
              <div className="inventory-drawer__form-actions">
                <Button type="button" variant="secondary" disabled={saving} onClick={onCancelEdit}>
                  Cancel changes
                </Button>
                <Button type="submit" disabled={saving || !dirty} icon="check">
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          ) : (
            <section className="inventory-drawer__section">
              <div className="inventory-drawer__section-heading">
                <div>
                  <span className="inventory-kicker">Item details</span>
                  <h3>Configuration</h3>
                </div>
              </div>
              <div className="inventory-drawer__detail-list">
                <div>
                  <span>Supplier</span>
                  <strong>{item.supplierName || "Unassigned"}</strong>
                </div>
                <div>
                  <span>SKU</span>
                  <strong>{item.sku || "Not assigned"}</strong>
                </div>
                <div>
                  <span>Unit</span>
                  <strong>{item.unit}</strong>
                </div>
                <div>
                  <span>Unit cost</span>
                  <strong>{formatCurrency(item.unitCost)}</strong>
                </div>
                <div>
                  <span>Stock status</span>
                  <StatusBadge item={item} />
                </div>
              </div>
            </section>
          )}

          <section className="inventory-drawer__section">
            <div className="inventory-drawer__section-heading">
              <div>
                <span className="inventory-kicker">Operations</span>
                <h3>Update stock</h3>
              </div>
            </div>
            <div className="inventory-drawer__action-grid">
              <Button
                variant="secondary"
                icon="stockIn"
                disabled={disabledActions}
                onClick={onReceive}
              >
                Receive stock
              </Button>
              <Button
                variant="secondary"
                icon="scissors"
                disabled={disabledActions || item.category === "Equipment"}
                onClick={onUsage}
              >
                Record usage
              </Button>
              <Button
                variant="secondary"
                icon="refresh"
                disabled={disabledActions}
                onClick={onAdjust}
              >
                Adjust quantity
              </Button>
              <Button
                variant="secondary"
                icon="trash"
                disabled={disabledActions}
                onClick={onDamage}
              >
                Mark damaged / discarded
              </Button>
              <Button
                variant="secondary"
                icon="box"
                disabled={disabledActions || !item.supplierId}
                onClick={onRestock}
              >
                Request restock
              </Button>
              <Button variant="ghost" icon="clock" onClick={onHistory}>
                View movement history
              </Button>
            </div>
            {item.category === "Equipment" && (
              <p className="form-hint inventory-drawer__action-note">
                Usage is recorded through adjustments for equipment; supplies and products support
                barber usage.
              </p>
            )}
            {!item.supplierId && (
              <p className="form-hint inventory-drawer__action-note">
                To request a restock, choose a supplier with Edit item above, or assign this item
                from Suppliers → Assign items.
              </p>
            )}
          </section>
          <section className="inventory-drawer__section inventory-drawer__recent">
            <div className="inventory-drawer__section-heading">
              <div>
                <span className="inventory-kicker">Audit trail</span>
                <h3>Recent movement</h3>
              </div>
              {history.length > 0 && (
                <Button size="sm" variant="ghost" onClick={onHistory}>
                  View all
                </Button>
              )}
            </div>
            {historyLoading ? (
              <p className="inventory-drawer__loading">Loading movement history…</p>
            ) : history.length ? (
              <div className="inventory-movement-list">
                {history.slice(0, 4).map((movement) => (
                  <div className="inventory-movement" key={movement.id}>
                    <span className="inventory-movement__dot" />
                    <div>
                      <strong>{movementLabel(movement.movement_type)}</strong>
                      <small>
                        {new Date(movement.created_at).toLocaleString()} ·{" "}
                        {movement.created_by_name}
                      </small>
                    </div>
                    <b>
                      {movement.previous_stock} → {movement.new_stock}
                    </b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="inventory-drawer__empty">No stock movements have been recorded yet.</p>
            )}
          </section>
        </div>
        {canDelete && (
          <footer className="inventory-drawer__footer">
            <Button variant="danger" icon="trash" onClick={onDeactivate}>
              Delete item
            </Button>
          </footer>
        )}
      </aside>
    </div>
  );
}

export function InventoryPage(props: {
  onToast: (message: string) => void;
  admin?: boolean;
  canDelete: boolean;
}) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = useBranchContext();
  const branchControl = (
    <BranchSwitcher
      branches={branches}
      value={branchId}
      loading={branchLoading}
      onChange={setBranchId}
    />
  );
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "";
  if (branchId > 0)
    return (
      <InventoryPageContent
        key={branchId}
        {...props}
        branchId={branchId}
        branchName={branchName}
        branchControl={branchControl}
      />
    );
  if (branchLoading && !branchError) return <ListPageSkeleton metrics label="Loading inventory" />;
  return (
    <div className="operational-workspace">
      {branchControl}
      {branchError ? (
        <p role="alert">{branchError}</p>
      ) : (
        <p className="operational-loading">No branch assigned.</p>
      )}
    </div>
  );
}

function InventoryPageContent({
  onToast: notify,
  canDelete,
  branchId,
  branchName,
  branchControl,
}: {
  branchControl: ReactNode;
  onToast: (message: string) => void;
  admin?: boolean;
  canDelete: boolean;
  branchId: number;
  branchName: string;
}) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const onToast = useCallback(
    (message: string) => {
      if (active.current) notify(message);
    },
    [notify],
  );
  // Paint the last loaded catalog at once; refreshes replace it without a loading flash.
  const [items, setItems] = useState<ApiInventoryItem[]>(
    () =>
      peekApiBody<{ items?: ApiInventoryItem[] }>(`/api/inventory?branchId=${branchId}`)?.items ??
      [],
  );
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>(
    () => peekApiBody<{ suppliers?: ApiSupplier[] }>("/api/suppliers")?.suppliers ?? [],
  );
  const [hadCache] = useState(() => Boolean(peekApiBody(`/api/inventory?branchId=${branchId}`)));
  const hasLoaded = useRef(hadCache);
  const [loading, setLoading] = useState(!hadCache);
  const [loadError, setLoadError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [status, setStatus] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [drawerItem, setDrawerItem] = useState<ApiInventoryItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerForm, setDrawerForm] = useState<ItemForm>(emptyForm);
  const [drawerEditing, setDrawerEditing] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerHistory, setDrawerHistory] = useState<Movement[]>([]);
  const [drawerHistoryLoading, setDrawerHistoryLoading] = useState(false);
  const [drawerClosePrompt, setDrawerClosePrompt] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiInventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movementItem, setMovementItem] = useState<ApiInventoryItem | null>(null);
  const [movementForm, setMovementForm] = useState<MovementForm>(emptyMovement);
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [movementError, setMovementError] = useState("");
  const [historyItem, setHistoryItem] = useState<ApiInventoryItem | null>(null);
  const [history, setHistory] = useState<Movement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restockItem, setRestockItem] = useState<ApiInventoryItem | null>(null);
  const [restockQuantity, setRestockQuantity] = useState("1");
  const [restockNotes, setRestockNotes] = useState("");
  const [restockSubmitting, setRestockSubmitting] = useState(false);
  const [restockError, setRestockError] = useState("");

  const initialLinkHandled = useRef(false);
  const loadInventory = useCallback(async () => {
    if (!active.current) return;
    if (!hasLoaded.current) setLoading(true);
    try {
      const response = await apiRequest(`/api/inventory?branchId=${branchId}`, {
        cache: "no-store",
      });
      const body = await readApiBody<{
        success: boolean;
        items?: ApiInventoryItem[];
        message?: string;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success || !body.items)
        throw new Error(body?.message ?? "Unable to load inventory");
      setItems(body.items);
      hasLoaded.current = true;
      if (!initialLinkHandled.current) {
        initialLinkHandled.current = true;
        const linked = body.items.find(
          (item) => String(item.id) === new URLSearchParams(window.location.search).get("item"),
        );
        if (linked) {
          setSearch(linked.name);
        }
      }
      setDrawerItem((current) =>
        current ? (body.items?.find((item) => item.id === current.id) ?? current) : current,
      );
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load inventory";
      setLoadError(message);
      onToast(message);
    } finally {
      setLoading(false);
    }
  }, [onToast, branchId]);

  const loadSuppliers = useCallback(async () => {
    try {
      const response = await apiRequest("/api/suppliers", { cache: "no-store" });
      const body = await readApiBody<{ success: boolean; suppliers?: ApiSupplier[] }>(response);
      if (!active.current) return;
      if (response.ok && body?.success) setSuppliers(body.suppliers ?? []);
    } catch {
      /* Inventory remains usable if supplier options fail to load. */
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadInventory();
      void loadSuppliers();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadInventory, loadSuppliers]);

  const supplierOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const supplier of suppliers) byId.set(supplier.id, supplier.companyName);
    for (const item of items)
      if (item.supplierId && item.supplierName) byId.set(item.supplierId, item.supplierName);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items, suppliers]);
  const categoryFilterOptions = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const matchesSearch =
          !normalizedSearch ||
          `${item.name} ${item.sku ?? ""}`.toLowerCase().includes(normalizedSearch);
        const matchesCategory = category === "all" || item.category === category;
        const matchesSupplier =
          supplierFilter === "all" || String(item.supplierId ?? "none") === supplierFilter;
        const matchesStatus =
          status === "all" ? item.status === "active" : stockStatus(item) === status;
        return matchesSearch && matchesCategory && matchesSupplier && matchesStatus;
      }),
    [category, normalizedSearch, items, status, supplierFilter],
  );
  const sortedFiltered = useMemo(
    () =>
      [...filtered].sort((first, second) => {
        const valueFor = (item: ApiInventoryItem) =>
          sortKey === "name"
            ? item.name.toLowerCase()
            : sortKey === "sku"
              ? (item.sku ?? "").toLowerCase()
              : sortKey === "supplier"
                ? (item.supplierName ?? "").toLowerCase()
                : sortKey === "quantity"
                  ? item.quantity
                  : sortKey === "threshold"
                    ? item.minimumStock
                    : sortKey === "unitCost"
                      ? item.unitCost
                      : stockStatusLabel(stockStatus(item)).toLowerCase();
        const left = valueFor(first);
        const right = valueFor(second);
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return comparison * (sortDirection === "asc" ? 1 : -1);
      }),
    [filtered, sortDirection, sortKey],
  );
  const lowStock = items.filter(
    (item) => item.status === "active" && stockStatus(item) === "low_stock",
  );
  const outOfStock = items.filter(
    (item) => item.status === "active" && stockStatus(item) === "out_of_stock",
  );
  const activeItems = items.filter((item) => item.status === "active");
  const inventoryValue = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const drawerDirty = drawerItem ? formHasChanged(drawerItem, drawerForm) : false;

  function openCreate() {
    setForm({ ...emptyForm, branch: branchName });
    setFormError("");
    setModalOpen(true);
  }
  function closeEditor() {
    if (!submitting) {
      setModalOpen(false);
      setFormError("");
    }
  }
  function openDrawer(item: ApiInventoryItem) {
    setDrawerItem(item);
    setDrawerOpen(true);
    setDrawerForm(formFromItem(item));
    setDrawerEditing(false);
    setDrawerClosePrompt(false);
    setDrawerHistory([]);
    void loadDrawerHistory(item);
  }
  function requestDrawerClose() {
    if (drawerSaving) return;
    if (drawerDirty) setDrawerClosePrompt(true);
    else {
      setDrawerOpen(false);
      setDrawerEditing(false);
    }
  }
  function confirmDrawerClose() {
    setDrawerClosePrompt(false);
    setDrawerOpen(false);
    setDrawerEditing(false);
  }

  async function loadDrawerHistory(item: ApiInventoryItem) {
    setDrawerHistoryLoading(true);
    try {
      const response = await apiRequest(
        `/api/inventory/${item.id}/movements?branchId=${branchId}`,
        { cache: "no-store" },
      );
      const body = await readApiBody<{
        success: boolean;
        movements?: Movement[];
        message?: string;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to load movement history");
      setDrawerHistory(body.movements ?? []);
    } catch (error) {
      setDrawerHistory([]);
      onToast(error instanceof Error ? error.message : "Unable to load movement history");
    } finally {
      setDrawerHistoryLoading(false);
    }
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
      if (!active.current) return;
      if (!response.ok || !body?.success || !body.item)
        throw new Error(responseMessage(body, "Unable to add inventory item"));
      setModalOpen(false);
      onToast(`${body.item.name} added to inventory`);
      await loadInventory();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to add inventory item");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveDrawerItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!drawerItem) return;
    setDrawerSaving(true);
    try {
      if (!drawerForm.name.trim()) throw new Error("Item name is required.");
      const changeStock = stockChanged(drawerItem, drawerForm);
      const counted = changeStock
        ? parseNumber(drawerForm.initialQuantity, "Current stock", true)
        : drawerItem.quantity;
      if (changeStock && !drawerForm.stockReason.trim())
        throw new Error("Add a reason for the stock change.");
      let saved = drawerItem;
      if (detailsChanged(drawerItem, drawerForm)) {
        const response = await apiRequest(`/api/inventory/${drawerItem.id}?branchId=${branchId}`, {
          method: "PUT",
          body: JSON.stringify(itemPayload(drawerForm, false)),
        });
        const body = await readApiBody<{
          success: boolean;
          item?: ApiInventoryItem;
          message?: string;
          errors?: Record<string, string[]>;
        }>(response);
        if (!active.current) return;
        if (!response.ok || !body?.success || !body.item)
          throw new Error(responseMessage(body, "Unable to save inventory item"));
        saved = body.item;
      }
      if (changeStock) {
        const difference = counted - drawerItem.quantity;
        const response = await apiRequest(
          `/api/inventory/${drawerItem.id}/movements?branchId=${branchId}`,
          {
            method: "POST",
            body: JSON.stringify({
              movementType: "ADJUSTMENT",
              quantity: Math.abs(difference),
              adjustmentDirection: difference > 0 ? "increase" : "decrease",
              supplierId: saved.supplierId,
              unitCost: null,
              reference: null,
              notes: drawerForm.stockReason.trim(),
            }),
          },
        );
        const body = await readApiBody<{
          success: boolean;
          message?: string;
          errors?: Record<string, string[]>;
        }>(response);
        if (!active.current) return;
        if (!response.ok || !body?.success)
          throw new Error(
            responseMessage(body, "Details saved, but the stock change could not be recorded"),
          );
        saved = { ...saved, quantity: counted };
        void loadDrawerHistory(saved);
      }
      setDrawerItem(saved);
      setDrawerForm(formFromItem(saved));
      setDrawerEditing(false);
      onToast(`${saved.name} updated${changeStock ? ` · stock now ${counted} ${saved.unit}` : ""}`);
      await loadInventory();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to save inventory item");
    } finally {
      setDrawerSaving(false);
    }
  }

  function openMovement(item: ApiInventoryItem, movementType: MovementType) {
    setMovementItem(item);
    setMovementError("");
    setMovementForm({
      ...emptyMovement,
      movementType,
      countedStock: String(item.quantity),
      unitCost: movementType === "RECEIVE" ? String(item.unitCost) : "",
    });
  }
  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementItem) return;
    setMovementError("");
    setMovementSubmitting(true);
    try {
      if (movementForm.movementType === "ADJUSTMENT" && !movementForm.notes.trim())
        throw new Error("A reason is required for manual adjustments.");
      const delta = movementDelta(movementItem, movementForm);
      if (movementForm.movementType === "ADJUSTMENT") {
        if (delta === null)
          throw new Error("Enter the actual count as a whole number of 0 or more.");
        if (delta === 0)
          throw new Error(
            `The count matches the current stock of ${movementItem.quantity}. Nothing to adjust.`,
          );
      }
      if (delta !== null && movementItem.quantity + delta < 0)
        throw new Error(
          `Only ${movementItem.quantity} ${movementItem.unit} in stock. You cannot remove more than that.`,
        );
      const payload = {
        movementType: movementForm.movementType,
        quantity:
          movementForm.movementType === "ADJUSTMENT"
            ? Math.abs(delta ?? 0)
            : parsePositiveInt(movementForm.quantity, "Quantity"),
        supplierId: movementItem.supplierId,
        unitCost: movementForm.unitCost.trim()
          ? parseNumber(movementForm.unitCost, "Unit cost")
          : null,
        reference: movementForm.reference.trim() || null,
        notes: movementForm.notes.trim(),
        ...(movementForm.movementType === "ADJUSTMENT"
          ? { adjustmentDirection: (delta ?? 0) > 0 ? "increase" : "decrease" }
          : {}),
      };
      const response = await apiRequest(
        `/api/inventory/${movementItem.id}/movements?branchId=${branchId}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      const body = await readApiBody<{
        success: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(responseMessage(body, "Unable to record stock operation"));
      setMovementItem(null);
      onToast(
        `${movementLabel(movementForm.movementType)} recorded · ${movementItem.name} now ${movementItem.quantity + (delta ?? 0)} ${movementItem.unit}`,
      );
      await loadInventory();
      if (drawerItem?.id === movementItem.id) void loadDrawerHistory(movementItem);
    } catch (error) {
      setMovementError(error instanceof Error ? error.message : "Unable to record stock operation");
    } finally {
      setMovementSubmitting(false);
    }
  }

  async function openHistory(item: ApiInventoryItem) {
    setHistoryItem(item);
    setHistoryLoading(true);
    try {
      const response = await apiRequest(
        `/api/inventory/${item.id}/movements?branchId=${branchId}`,
        { cache: "no-store" },
      );
      const body = await readApiBody<{
        success: boolean;
        movements?: Movement[];
        message?: string;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to load movement history");
      setHistory(body.movements ?? []);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to load movement history");
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openRestock(item: ApiInventoryItem) {
    if (!item.supplierId) {
      onToast("Assign a supplier before requesting a restock");
      return;
    }
    const target = item.maximumStock ?? Math.max(item.minimumStock * 2, item.quantity + 1);
    setRestockItem(item);
    setRestockQuantity(String(Math.max(1, target - item.quantity)));
    setRestockNotes("");
    setRestockError("");
  }
  async function submitRestock(event: FormEvent) {
    event.preventDefault();
    if (!restockItem?.supplierId) return;
    setRestockSubmitting(true);
    setRestockError("");
    try {
      const requestedQuantity = parsePositiveInt(restockQuantity, "Requested quantity");
      const response = await apiRequest(`/api/restocks?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify({
          supplierId: restockItem.supplierId,
          branch: restockItem.branch,
          reference: null,
          notes: restockNotes.trim(),
          items: [
            { inventoryItemId: restockItem.id, requestedQuantity, unitCost: restockItem.unitCost },
          ],
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(responseMessage(body, "Unable to create restock request"));
      setRestockItem(null);
      onToast(`Restock request submitted for ${restockItem.name}`);
    } catch (error) {
      setRestockError(error instanceof Error ? error.message : "Unable to create restock request");
    } finally {
      setRestockSubmitting(false);
    }
  }

  async function deleteItem(item: ApiInventoryItem) {
    setDeleting(true);
    try {
      const response = await apiRequest(`/api/inventory/${item.id}?branchId=${branchId}`, {
        method: "DELETE",
      });
      const body = await readApiBody<{
        success: boolean;
        outcome?: "deleted" | "archived";
        message?: string;
      }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to delete inventory item");
      setPendingDelete(null);
      if (drawerItem?.id === item.id) setDrawerOpen(false);
      onToast(
        body.outcome === "archived"
          ? `${item.name} archived (it has stock history)`
          : `${item.name} deleted`,
      );
      await loadInventory();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to delete inventory item");
    } finally {
      setDeleting(false);
    }
  }

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey)
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
  }
  function exportInventory() {
    downloadCsv(
      "barracks-inventory.csv",
      [
        "Item",
        "SKU",
        "Supplier",
        "Current stock",
        "Minimum stock",
        "Maximum stock",
        "Unit cost",
        "Status",
      ],
      sortedFiltered.map((item) => [
        item.name,
        item.sku ?? "",
        item.supplierName ?? "",
        `${item.quantity} ${item.unit}`,
        item.minimumStock,
        item.maximumStock ?? "",
        item.unitCost,
        stockStatusLabel(stockStatus(item)),
      ]),
    );
    onToast(
      `${sortedFiltered.length} inventory item${sortedFiltered.length === 1 ? "" : "s"} exported`,
    );
  }
  function tableRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, item: ApiInventoryItem) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrawer(item);
    }
  }

  return (
    <div className="inventory-workspace">
      <PageHeader
        title="Inventory Management"
        action={
          <>
            <OperationalViewToggle
              view={viewMode}
              onChange={setViewMode}
              label="Choose inventory view"
            />
            <Button icon="plus" onClick={openCreate}>
              Add item
            </Button>
          </>
        }
      >
        {branchControl}
      </PageHeader>
      <div className="metrics-grid metrics-grid--four inventory-metrics">
        <MetricCard label="Catalog items" value={String(items.length)} icon="box" accent="blue" />
        <MetricCard
          label="Active items"
          value={String(activeItems.length)}
          icon="checkCircle"
          accent="green"
        />
        <MetricCard
          label="Needs attention"
          value={String(lowStock.length + outOfStock.length)}
          icon="info"
          accent="amber"
        />
        <MetricCard
          label="Inventory value"
          value={formatCurrency(inventoryValue)}
          icon="wallet"
          accent="violet"
        />
      </div>
      <Panel className="inventory-catalog-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>{viewMode === "cards" ? "Everyday inventory" : "Detailed inventory list"}</h2>
          </div>
          <div className="inventory-catalog-count">
            <strong>{sortedFiltered.length}</strong>
            <span>of {items.length} items</span>
          </div>
        </div>
        <div className="inventory-filter-bar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search item name or SKU"
            className="inventory-search"
          />
          <SelectField
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter inventory by category"
          >
            <option value="all">All categories</option>
            {categoryFilterOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
            aria-label="Filter inventory by supplier"
          >
            <option value="all">All suppliers</option>
            <option value="none">No supplier</option>
            {supplierOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="inventory-status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as StockFilter)}
            aria-label="Filter inventory by stock status"
          >
            <option value="all">All active items</option>
            <option value="in_stock">In stock</option>
            <option value="low_stock">Low stock</option>
            <option value="out_of_stock">Out of stock</option>
            <option value="inactive">Archived</option>
          </SelectField>
        </div>
        <div className="inventory-results-bar">
          <span>
            {loading
              ? "Loading catalog…"
              : `${sortedFiltered.length} result${sortedFiltered.length === 1 ? "" : "s"}`}
            {search ? ` for “${search}”` : ""}
          </span>
          {viewMode === "table" && (
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              onClick={exportInventory}
              disabled={!sortedFiltered.length}
            >
              Export CSV
            </Button>
          )}
        </div>
        {loading ? (
          <LoadingCards />
        ) : loadError ? (
          <div className="inventory-state" role="alert">
            <Icon name="refresh" size={23} />
            <strong>{loadError}</strong>
            <Button size="sm" variant="secondary" onClick={() => void loadInventory()}>
              Try again
            </Button>
          </div>
        ) : sortedFiltered.length === 0 ? (
          <EmptyState
            icon="box"
            title="No inventory matches"
            description="Try a different item name, SKU, category, supplier, or stock status."
            action={
              <Button size="sm" icon="plus" onClick={openCreate}>
                Add item
              </Button>
            }
          />
        ) : viewMode === "cards" ? (
          <div className="inventory-card-grid">
            {sortedFiltered.map((item) => (
              <InventoryCard
                key={item.id}
                item={item}
                onOpen={() => openDrawer(item)}
                onRestock={() => openRestock(item)}
              />
            ))}
          </div>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-data-table">
              <thead>
                <tr>
                  {(
                    [
                      ["name", "Item"],
                      ["sku", "SKU"],
                      ["supplier", "Supplier"],
                      ["quantity", "Current stock"],
                      ["threshold", "Min / max"],
                      ["unitCost", "Unit cost"],
                      ["status", "Status"],
                    ] as Array<[SortKey, string]>
                  ).map(([key, label]) => (
                    <th key={key} scope="col">
                      <button type="button" onClick={() => handleSort(key)}>
                        {label}
                        <Icon
                          name={
                            sortKey === key && sortDirection === "desc" ? "arrowDown" : "arrowUp"
                          }
                          size={12}
                          className={sortKey === key ? "is-visible" : ""}
                        />
                      </button>
                    </th>
                  ))}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    onClick={() => openDrawer(item)}
                    onKeyDown={(event) => tableRowKeyDown(event, item)}
                    aria-label={`Open ${item.name}`}
                  >
                    <td>
                      <button
                        type="button"
                        className="inventory-table__item"
                        onClick={(event) => {
                          event.stopPropagation();
                          openDrawer(item);
                        }}
                      >
                        <span className="inventory-table__icon">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <ProductImagePlaceholder />
                          )}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.category} · {item.branch}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{item.sku || "—"}</td>
                    <td>{item.supplierName || "Unassigned"}</td>
                    <td
                      className={
                        item.quantity <= item.minimumStock && item.status === "active"
                          ? "inventory-table__stock-alert"
                          : ""
                      }
                    >
                      <strong>{item.quantity}</strong> {item.unit}
                    </td>
                    <td>
                      {item.minimumStock} / {item.maximumStock ?? "—"}
                    </td>
                    <td>{formatCurrency(item.unitCost)}</td>
                    <td>
                      <StatusBadge item={item} />
                    </td>
                    <td>
                      <span
                        className="inventory-table__actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <IconButton
                          label={`Restock ${item.name}`}
                          icon="stockIn"
                          disabled={item.status === "inactive" || !item.supplierId}
                          onClick={() => openRestock(item)}
                        />
                        <IconButton
                          label={`Edit ${item.name}`}
                          icon="edit"
                          onClick={() => openDrawer(item)}
                        />
                        <IconButton
                          label={`History for ${item.name}`}
                          icon="clock"
                          onClick={() => openHistory(item)}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={modalOpen}
        title="Add inventory item"
        description="Create a trackable item for the selected branch."
        onClose={closeEditor}
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
            <Button variant="secondary" type="button" disabled={submitting} onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="submit" icon="check" disabled={submitting}>
              {submitting ? "Saving…" : "Save item"}
            </Button>
          </div>
        </form>
      </Modal>

      {drawerItem && (
        <InventoryDrawer
          open={drawerOpen}
          item={drawerItem}
          form={drawerForm}
          editing={drawerEditing}
          dirty={drawerDirty}
          canDelete={canDelete}
          saving={drawerSaving}
          history={drawerHistory}
          historyLoading={drawerHistoryLoading}
          suppliers={suppliers}
          onRequestClose={requestDrawerClose}
          onEdit={() => setDrawerEditing(true)}
          onFormChange={(field, value) =>
            setDrawerForm((current) => ({ ...current, [field]: value }))
          }
          onSave={saveDrawerItem}
          onCancelEdit={() => {
            setDrawerForm(formFromItem(drawerItem));
            setDrawerEditing(false);
          }}
          onReceive={() => openMovement(drawerItem, "RECEIVE")}
          onUsage={() => openMovement(drawerItem, "STAFF_USAGE")}
          onAdjust={() => openMovement(drawerItem, "ADJUSTMENT")}
          onDamage={() => openMovement(drawerItem, "DAMAGE")}
          onRestock={() => openRestock(drawerItem)}
          onHistory={() => void openHistory(drawerItem)}
          onDeactivate={() => setPendingDelete(drawerItem)}
        />
      )}

      <Modal
        open={Boolean(movementItem)}
        title={movementItem ? `Stock operation · ${movementItem.name}` : "Stock operation"}
        onClose={() => !movementSubmitting && setMovementItem(null)}
      >
        <form className="modal-form" onSubmit={submitMovement}>
          <SelectField
            label="Operation"
            value={movementForm.movementType}
            onChange={(event) =>
              setMovementForm({ ...movementForm, movementType: event.target.value as MovementType })
            }
          >
            <optgroup label="Add to stock">
              <option value="RECEIVE">Receive stock</option>
              <option value="RETURN">Returned to shelf</option>
            </optgroup>
            <optgroup label="Remove from stock">
              {(movementItem?.category === "Products" || movementItem?.category === "Supplies") && (
                <option value="CUSTOMER_PURCHASE">Sold to customer</option>
              )}
              {(movementItem?.category === "Products" || movementItem?.category === "Supplies") && (
                <option value="STAFF_USAGE">Used by barber</option>
              )}
              <option value="DAMAGE">Damaged stock</option>
              <option value="DISCARD">Discard stock</option>
            </optgroup>
            <optgroup label="Correct the count">
              <option value="ADJUSTMENT">Set actual count</option>
            </optgroup>
          </SelectField>
          {movementForm.movementType === "ADJUSTMENT" ? (
            <TextField
              required
              label={`Actual count on hand (${movementItem?.unit ?? "units"})`}
              type="number"
              min="0"
              step="1"
              value={movementForm.countedStock}
              onChange={(event) =>
                setMovementForm({ ...movementForm, countedStock: event.target.value })
              }
            />
          ) : (
            <TextField
              required
              label={
                stockIn.includes(movementForm.movementType)
                  ? "Quantity to add"
                  : "Quantity to remove"
              }
              type="number"
              min="1"
              step="1"
              value={movementForm.quantity}
              onChange={(event) =>
                setMovementForm({ ...movementForm, quantity: event.target.value })
              }
            />
          )}
          {movementItem &&
            (() => {
              const delta = movementDelta(movementItem, movementForm);
              const next = delta === null ? null : movementItem.quantity + delta;
              return (
                <p
                  className={`stock-preview ${next !== null && next < 0 ? "is-invalid" : ""}`}
                  aria-live="polite"
                >
                  <span>
                    Current <strong>{movementItem.quantity}</strong>
                  </span>
                  <Icon name="arrowRight" size={14} />
                  <span>
                    After <strong>{next ?? "—"}</strong> {movementItem.unit}
                  </span>
                  {delta !== null && delta !== 0 && (
                    <em className={delta > 0 ? "is-up" : "is-down"}>
                      {delta > 0 ? `+${delta}` : delta}
                    </em>
                  )}
                </p>
              );
            })()}
          {(movementForm.movementType === "RECEIVE" || movementForm.movementType === "RETURN") && (
            <TextField
              label="Unit cost"
              type="number"
              min="0"
              step="0.01"
              value={movementForm.unitCost}
              onChange={(event) =>
                setMovementForm({ ...movementForm, unitCost: event.target.value })
              }
            />
          )}
          <TextField
            label="Reference"
            value={movementForm.reference}
            onChange={(event) =>
              setMovementForm({ ...movementForm, reference: event.target.value })
            }
            placeholder="PO, delivery receipt, sale or service ref"
          />
          <TextField
            label={movementForm.movementType === "ADJUSTMENT" ? "Reason" : "Notes"}
            required={movementForm.movementType === "ADJUSTMENT"}
            value={movementForm.notes}
            onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })}
            placeholder={
              movementForm.movementType === "STAFF_USAGE"
                ? "Barber, service, or purpose"
                : movementForm.movementType === "CUSTOMER_PURCHASE"
                  ? "Sale or receipt reference"
                  : undefined
            }
          />
          {movementError && (
            <p className="form-error" role="alert">
              {movementError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={movementSubmitting}
              onClick={() => setMovementItem(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={movementSubmitting}>
              {movementSubmitting ? "Recording…" : "Record operation"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(restockItem)}
        title={restockItem ? `Request restock · ${restockItem.name}` : "Request restock"}
        onClose={() => !restockSubmitting && setRestockItem(null)}
      >
        <form className="modal-form" onSubmit={submitRestock}>
          {restockItem && (
            <p className="form-hint">
              Supplier: {restockItem.supplierName ?? "Assigned supplier"} · Branch:{" "}
              {restockItem.branch} · Current stock: {restockItem.quantity} {restockItem.unit}
            </p>
          )}
          <TextField
            required
            label="Requested quantity"
            type="number"
            min="1"
            step="1"
            value={restockQuantity}
            onChange={(event) => setRestockQuantity(event.target.value)}
          />
          <TextField
            label="Notes"
            value={restockNotes}
            onChange={(event) => setRestockNotes(event.target.value)}
            placeholder="Optional restock notes"
          />
          {restockError && (
            <p className="form-error" role="alert">
              {restockError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={restockSubmitting}
              onClick={() => setRestockItem(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={restockSubmitting}>
              {restockSubmitting ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(historyItem)}
        title={historyItem ? `${historyItem.name} movement history` : "Movement history"}
        onClose={() => setHistoryItem(null)}
      >
        {historyLoading ? (
          <p className="inventory-modal-loading">Loading history…</p>
        ) : history.length ? (
          <div className="staff-table staff-table--cols-4 inventory-history-table">
            {history.map((movement) => (
              <div className="staff-table__row" key={movement.id}>
                <span>
                  <strong>{movementLabel(movement.movement_type)}</strong>
                  <small>
                    {new Date(movement.created_at).toLocaleString()} · {movement.created_by_name} ·{" "}
                    {movement.branch}
                  </small>
                </span>
                <span>
                  {movement.previous_stock} → {movement.new_stock}
                </span>
                <span>{movement.reference ?? "No reference"}</span>
                <span>{movement.notes || "No notes"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="inventory-modal-loading">No stock movements have been recorded yet.</p>
        )}
      </Modal>
      <ConfirmDialog
        open={drawerClosePrompt}
        title="Discard unsaved changes?"
        description="Your item edits will be lost if you close this drawer now."
        confirmLabel="Discard changes"
        danger
        onClose={() => setDrawerClosePrompt(false)}
        onConfirm={confirmDrawerClose}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this inventory item?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be removed from inventory. If it has stock history, it is archived instead so past records stay accurate; find it under the Archived filter.`
            : undefined
        }
        confirmLabel="Delete item"
        danger
        busy={deleting}
        onClose={() => !deleting && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteItem(pendingDelete)}
      />
    </div>
  );
}
