"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { Button, Modal, SearchInput } from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { useBranchContext } from "@/app/utils/use-branch-context";

// Choose which inventory items a supplier provides in one branch. Restock requests
// can only include items assigned to the supplier, so this is where that link is made.
export function SupplierItemsModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: ApiSupplier | null;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const { branches, branchId, setBranchId, branchLoading } = useBranchContext();
  const [items, setItems] = useState<ApiInventoryItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const selectionScope = supplier && branchId ? `${supplier.id}:${branchId}` : "";
  const ready = Boolean(selectionScope && loadedScope === selectionScope);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadedScope("");
      setError("");
      if (!supplier || !branchId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const response = await apiRequest(`/api/inventory?branchId=${branchId}`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          items?: ApiInventoryItem[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !Array.isArray(body.items))
          throw new Error(body?.message ?? "Unable to load inventory");
        if (!active) return;
        const list = body.items.filter(
          (item) => item.status === "active" || item.supplierId === supplier.id,
        );
        setItems(list);
        setSelected(
          new Set(list.filter((item) => item.supplierId === supplier.id).map((item) => item.id)),
        );
        setLoadedScope(selectionScope);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load inventory");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [supplier, branchId, selectionScope]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        !query || `${item.name} ${item.sku ?? ""} ${item.category}`.toLowerCase().includes(query),
    );
  }, [items, search]);

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!supplier || !ready || saving || loading || branchLoading) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiRequest(
        `/api/suppliers/${supplier.id}/items?branchId=${branchId}`,
        { method: "PUT", body: JSON.stringify({ inventoryItemIds: [...selected] }) },
      );
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to save supplied items");
      onSaved(selected.size);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save supplied items");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(supplier)}
      title={supplier ? `Items supplied by ${supplier.companyName}` : "Supplied items"}
      description="Tick every item this supplier provides. Only assigned items can be added to a restock request."
      onClose={() => !saving && onClose()}
    >
      <div className="modal-form supplier-items">
        <div className="supplier-items__toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search items" />
          <BranchSwitcher
            branches={branches}
            value={branchId}
            loading={branchLoading}
            disabled={saving}
            onChange={setBranchId}
          />
        </div>
        {loading || branchLoading ? (
          <p role="status" className="form-hint">
            Loading inventory…
          </p>
        ) : !ready ? (
          <p className="form-hint">
            {branchId
              ? "Inventory must load successfully before saving supplied items. Close and reopen this dialog to retry."
              : "Select an assigned branch to load inventory."}
          </p>
        ) : !items.length ? (
          <p className="form-hint">
            This branch has no inventory items yet. Add items under Inventory first.
          </p>
        ) : (
          <ul className="supplier-items__list">
            {visible.map((item) => {
              const otherSupplier =
                item.supplierId && item.supplierId !== supplier?.id ? item.supplierName : null;
              return (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      disabled={saving}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.category}
                        {item.sku ? ` · ${item.sku}` : ""}
                        {otherSupplier ? ` · currently from ${otherSupplier}` : ""}
                      </small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="form-hint">
          {ready ? selected.size : 0} item{!ready || selected.size !== 1 ? "s" : ""} selected.
          Ticking an item that another supplier provides moves it to this supplier after its open
          restock requests are received or cancelled.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            icon="check"
            disabled={saving || loading || branchLoading || !ready}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save items"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
