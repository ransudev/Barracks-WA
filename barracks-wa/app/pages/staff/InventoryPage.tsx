"use client";
import { ListPageSkeleton } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";


import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, peekApiBody, readApiBody, apiErrorMessage, errorMessage } from "@/app/lib/api";
import { downloadCsv } from "@/app/utils/download";
import { formatCurrency } from "@/app/utils/format";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
} from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { ViewToggle as OperationalViewToggle } from "@/app/components/operations/OperationalPrimitives";

import { AddItemDialog } from "./inventory/AddItemDialog";
import { HistoryDialog } from "./inventory/HistoryDialog";
import { InventoryCard, LoadingCards } from "./inventory/InventoryCard";
import { InventoryDrawer } from "./inventory/InventoryDrawer";
import { InventoryFilterBar } from "./inventory/InventoryFilterBar";
import { InventoryTable } from "./inventory/InventoryTable";
import { MovementDialog } from "./inventory/MovementDialog";
import { RestockDialog } from "./inventory/RestockDialog";
import { useInventoryFilters } from "./inventory/useInventoryFilters";
import {
  detailsChanged,
  emptyForm,
  formFromItem,
  formHasChanged,
  itemPayload,
  parseNumber,
  stockChanged,
  stockStatus,
  stockStatusLabel,
  type ItemForm,
  type Movement,
  type MovementType,
  type ViewMode,
} from "./inventory/model";

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
  const filters = useInventoryFilters(items, suppliers);
  const { setSearch, sortedFiltered, search } = filters;
  const [addOpen, setAddOpen] = useState(false);
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
  const [movement, setMovement] = useState<{ item: ApiInventoryItem; type: MovementType } | null>(
    null,
  );
  const [historyItem, setHistoryItem] = useState<ApiInventoryItem | null>(null);
  const [restockItem, setRestockItem] = useState<ApiInventoryItem | null>(null);

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
      const message = errorMessage(error, "Unable to load inventory");
      setLoadError(message);
      onToast(message);
    } finally {
      setLoading(false);
    }
  }, [onToast, branchId, setSearch]);

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

  const lowStock = items.filter(
    (item) => item.status === "active" && stockStatus(item) === "low_stock",
  );
  const outOfStock = items.filter(
    (item) => item.status === "active" && stockStatus(item) === "out_of_stock",
  );
  const activeItems = items.filter((item) => item.status === "active");
  const inventoryValue = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const drawerDirty = drawerItem ? formHasChanged(drawerItem, drawerForm) : false;

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
      onToast(errorMessage(error, "Unable to load movement history"));
    } finally {
      setDrawerHistoryLoading(false);
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
          throw new Error(apiErrorMessage(body, "Unable to save inventory item"));
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
            apiErrorMessage(body, "Details saved, but the stock change could not be recorded"),
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
      onToast(errorMessage(error, "Unable to save inventory item"));
    } finally {
      setDrawerSaving(false);
    }
  }

  function openRestock(item: ApiInventoryItem) {
    if (!item.supplierId) {
      onToast("Assign a supplier before requesting a restock");
      return;
    }
    setRestockItem(item);
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
      onToast(errorMessage(error, "Unable to delete inventory item"));
    } finally {
      setDeleting(false);
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
            <Button icon="plus" onClick={() => setAddOpen(true)}>
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
        <InventoryFilterBar filters={filters} />
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
              <Button size="sm" icon="plus" onClick={() => setAddOpen(true)}>
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
          <InventoryTable
            items={sortedFiltered}
            sortKey={filters.sortKey}
            sortDirection={filters.sortDirection}
            onSort={filters.handleSort}
            onOpen={openDrawer}
            onRestock={openRestock}
            onHistory={setHistoryItem}
          />
        )}
      </Panel>

      {addOpen && (
        <AddItemDialog
          branchId={branchId}
          branchName={branchName}
          suppliers={suppliers}
          onClose={() => setAddOpen(false)}
          onSaved={(item) => {
            setAddOpen(false);
            onToast(`${item.name} added to inventory`);
            void loadInventory();
          }}
        />
      )}

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
          onReceive={() => setMovement({ item: drawerItem, type: "RECEIVE" })}
          onUsage={() => setMovement({ item: drawerItem, type: "STAFF_USAGE" })}
          onAdjust={() => setMovement({ item: drawerItem, type: "ADJUSTMENT" })}
          onDamage={() => setMovement({ item: drawerItem, type: "DAMAGE" })}
          onRestock={() => openRestock(drawerItem)}
          onHistory={() => setHistoryItem(drawerItem)}
          onDeactivate={() => setPendingDelete(drawerItem)}
        />
      )}

      {movement && (
        <MovementDialog
          item={movement.item}
          initialType={movement.type}
          branchId={branchId}
          onClose={() => setMovement(null)}
          onRecorded={(message) => {
            const { item } = movement;
            setMovement(null);
            onToast(message);
            void loadInventory();
            if (drawerItem?.id === item.id) void loadDrawerHistory(item);
          }}
        />
      )}

      {restockItem && (
        <RestockDialog
          item={restockItem}
          branchId={branchId}
          onClose={() => setRestockItem(null)}
          onSubmitted={() => {
            setRestockItem(null);
            onToast(`Restock request submitted for ${restockItem.name}`);
          }}
        />
      )}

      {historyItem && (
        <HistoryDialog
          item={historyItem}
          branchId={branchId}
          onToast={onToast}
          onClose={() => setHistoryItem(null)}
        />
      )}
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
