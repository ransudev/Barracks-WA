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
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, peekApiBody, readApiBody, apiErrorMessage, errorMessage } from "@/app/lib/api";
import { downloadCsv } from "@/app/utils/download";
import { formatCurrency } from "@/app/utils/format";
import {
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

import { ItemPhotoField } from "./inventory/ItemPhotoField";
import {
  InventoryCard,
  LoadingCards,
  ProductImagePlaceholder,
  StatusBadge,
} from "./inventory/InventoryCard";
import { InventoryDrawer } from "./inventory/InventoryDrawer";
import {
  detailsChanged,
  emptyForm,
  emptyMovement,
  formFromItem,
  formHasChanged,
  itemPayload,
  movementDelta,
  movementLabel,
  parseNumber,
  parsePositiveInt,
  stockChanged,
  stockIn,
  stockStatus,
  stockStatusLabel,
  type ItemForm,
  type Movement,
  type MovementForm,
  type MovementType,
  type SortDirection,
  type SortKey,
  type StockFilter,
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
      const message = errorMessage(error, "Unable to load inventory");
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
      onToast(errorMessage(error, "Unable to load movement history"));
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
        throw new Error(apiErrorMessage(body, "Unable to add inventory item"));
      setModalOpen(false);
      onToast(`${body.item.name} added to inventory`);
      await loadInventory();
    } catch (error) {
      setFormError(errorMessage(error, "Unable to add inventory item"));
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
        throw new Error(apiErrorMessage(body, "Unable to record stock operation"));
      setMovementItem(null);
      onToast(
        `${movementLabel(movementForm.movementType)} recorded · ${movementItem.name} now ${movementItem.quantity + (delta ?? 0)} ${movementItem.unit}`,
      );
      await loadInventory();
      if (drawerItem?.id === movementItem.id) void loadDrawerHistory(movementItem);
    } catch (error) {
      setMovementError(errorMessage(error, "Unable to record stock operation"));
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
      onToast(errorMessage(error, "Unable to load movement history"));
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
        throw new Error(apiErrorMessage(body, "Unable to create restock request"));
      setRestockItem(null);
      onToast(`Restock request submitted for ${restockItem.name}`);
    } catch (error) {
      setRestockError(errorMessage(error, "Unable to create restock request"));
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
      onToast(errorMessage(error, "Unable to delete inventory item"));
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
