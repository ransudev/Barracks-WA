"use client";

/* Inventory photos are user-supplied data URLs, which next/image cannot resize
   or cache, so plain img tags are the right fit for this screen. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, type FormEvent } from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { Button, SelectField, TextField } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { useBodyScrollLock } from "@/app/hooks/useBodyScrollLock";
import { useDrawerPresence } from "@/app/hooks/useDrawerPresence";
import { formatCurrency } from "@/app/utils/format";
import { ItemPhotoField } from "./ItemPhotoField";
import { ProductImagePlaceholder, StatusBadge } from "./InventoryCard";
import { movementLabel, stockChanged, type ItemForm, type Movement } from "./model";

export function InventoryDrawer({
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
