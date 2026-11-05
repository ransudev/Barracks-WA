"use client";
import { ListPageSkeleton, SkeletonRows } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, readApiBody, apiErrorMessage, errorMessage } from "@/app/lib/api";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  Tabs,
  TextField,
} from "@/app/components/ui";
import {
  DetailDrawer,
  DrawerSection,
  FreshnessBar,
  FilterToolbar,
} from "@/app/components/operations/OperationalPrimitives";

type RestockItem = {
  id: number;
  inventoryItemId: number;
  itemName: string;
  branch: string;
  requestedQuantity: number;
  deliveredQuantity: number | null;
  unitCost: number | string | null;
};
type Restock = {
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
type DraftLine = { key: number; inventoryItemId: string; quantity: string; unitCost: string };
type CreateForm = {
  supplierId: string;
  branch: string;
  items: DraftLine[];
  reference: string;
  notes: string;
};
type ReceiveLine = { id: number; deliveredQuantity: string; unitCost: string };
const emptyCreate: CreateForm = {
  supplierId: "",
  branch: "",
  items: [{ key: 1, inventoryItemId: "", quantity: "1", unitCost: "" }],
  reference: "",
  notes: "",
};
function statusTone(status: Restock["status"]): "success" | "warning" | "danger" | "info" {
  return status === "Received"
    ? "success"
    : status === "Cancelled"
      ? "danger"
      : status === "Delivered"
        ? "info"
        : "warning";
}
const stages = [
  {
    id: "all",
    label: "All active",
    statuses: ["Pending", "Accepted", "Preparing", "Shipped", "Delivered"],
  },
  { id: "receive", label: "Ready to receive", statuses: ["Delivered"] },
  { id: "arrival", label: "In transit", statuses: ["Shipped"] },
  { id: "supplier", label: "With supplier", statuses: ["Pending", "Accepted", "Preparing"] },
];

export function RestockManagement({ onToast }: { onToast: (message: string) => void }) {
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
      <RestockContent
        key={branchId}
        branchId={branchId}
        branchName={branchName}
        onToast={onToast}
        branchControl={branchControl}
      />
    );
  if (branchLoading && !branchError)
    return <ListPageSkeleton cards={false} label="Loading restock requests" />;
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

function RestockContent({
  onToast: notify,
  branchId,
  branchName,
  branchControl,
}: {
  branchControl: ReactNode;
  onToast: (message: string) => void;
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
  const [stage, setStage] = useState("all");
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [inventory, setInventory] = useState<ApiInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("active");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [pendingDelivery, setPendingDelivery] = useState<Restock | null>(null);
  const requestVersion = useRef(0);
  const initialLinkHandled = useRef(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Restock | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Restock | null>(null);
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [receiveReference, setReceiveReference] = useState("");
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);
  const [markingDelivered, setMarkingDelivered] = useState<number | null>(null);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [restockResponse, supplierResponse, inventoryResponse] = await Promise.all([
        apiRequest(`/api/restocks?branchId=${branchId}`, { cache: "no-store" }),
        apiRequest("/api/suppliers", { cache: "no-store" }),
        apiRequest(`/api/inventory?branchId=${branchId}`, { cache: "no-store" }),
      ]);
      const restockBody = await readApiBody<{
        success: boolean;
        restocks?: Restock[];
        message?: string;
      }>(restockResponse);
      const supplierBody = await readApiBody<{
        success: boolean;
        suppliers?: ApiSupplier[];
        message?: string;
      }>(supplierResponse);
      const inventoryBody = await readApiBody<{
        success: boolean;
        items?: ApiInventoryItem[];
        message?: string;
      }>(inventoryResponse);
      if (!restockResponse.ok || !restockBody?.success)
        throw new Error(restockBody?.message ?? "Unable to load restock requests");
      if (!supplierResponse.ok || !supplierBody?.success)
        throw new Error(supplierBody?.message ?? "Unable to load suppliers");
      if (!inventoryResponse.ok || !inventoryBody?.success)
        throw new Error(inventoryBody?.message ?? "Unable to load inventory");
      if (version !== requestVersion.current) return;
      setRestocks(restockBody.restocks ?? []);
      if (!initialLinkHandled.current) {
        initialLinkHandled.current = true;
        const linked = (restockBody.restocks ?? []).find(
          (item) => String(item.id) === new URLSearchParams(window.location.search).get("request"),
        );
        if (linked) {
          setSelected(linked);
          if (["Received", "Cancelled"].includes(linked.status)) setTab("history");
        }
      }
      setSelected((current) =>
        current
          ? ((restockBody.restocks ?? []).find((item) => item.id === current.id) ?? null)
          : null,
      );
      setSuppliers(supplierBody.suppliers ?? []);
      setInventory(inventoryBody.items ?? []);
      setLoadError("");
      setUpdatedAt(Date.now());
    } catch (error) {
      const message = errorMessage(error, "Unable to load restock requests");
      if (version === requestVersion.current) {
        setLoadError(message);
        onToast(message);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [onToast, branchId]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return restocks.filter(
      (restock) =>
        (tab === "history"
          ? ["Received", "Cancelled"].includes(restock.status)
          : !["Received", "Cancelled"].includes(restock.status)) &&
        (!query ||
          `${restock.id} ${restock.supplier_name} ${restock.branch} ${restock.reference ?? ""} ${restock.items.map((item) => item.itemName).join(" ")}`
            .toLowerCase()
            .includes(query)) &&
        (statusFilter === "all" || restock.status === statusFilter),
    );
  }, [restocks, search, statusFilter, tab]);

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
  function openCreate() {
    setCreateForm({
      ...emptyCreate,
      branch: branchName,
      items: [{ ...emptyCreate.items[0], key: Date.now() }],
    });
    setCreateOpen(true);
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
  function openReceive(restock: Restock) {
    setReceiving(restock);
    setReceiveLines(
      restock.items.map((item) => ({
        id: item.id,
        deliveredQuantity: String(item.requestedQuantity),
        unitCost:
          item.unitCost === null || item.unitCost === undefined ? "" : String(item.unitCost),
      })),
    );
    setReceiveReference(restock.reference ?? "");
    setReceiveNotes("");
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
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(apiErrorMessage(body, "Unable to create restock request"));
      setCreateOpen(false);
      onToast("Restock request sent to supplier");
      await load();
    } catch (error) {
      onToast(errorMessage(error, "Unable to create restock request"));
    } finally {
      setCreating(false);
    }
  }
  const [pendingCancel, setPendingCancel] = useState<Restock | null>(null);
  const [cancelling, setCancelling] = useState(false);
  async function cancelRequest(restock: Restock) {
    setCancelling(true);
    try {
      const response = await apiRequest(`/api/restocks/${restock.id}/cancel?branchId=${branchId}`, {
        method: "POST",
      });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to cancel request");
      onToast(`Restock #${restock.id} cancelled`);
      setSelected(null);
      await load();
    } catch (error) {
      onToast(errorMessage(error, "Unable to cancel request"));
    } finally {
      setCancelling(false);
    }
  }
  async function markDelivered(restock: Restock) {
    setMarkingDelivered(restock.id);
    try {
      const response = await apiRequest(
        `/api/restocks/${restock.id}/delivered?branchId=${branchId}`,
        { method: "POST" },
      );
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to confirm delivery");
      onToast(`Restock #${restock.id} arrived. Receive it to add the stock`);
      await load();
    } catch (error) {
      onToast(errorMessage(error, "Unable to confirm delivery"));
    } finally {
      setMarkingDelivered(null);
    }
  }
  async function receive(event: FormEvent) {
    event.preventDefault();
    if (!receiving) return;
    setReceiveSubmitting(true);
    try {
      const items = receiveLines.map((line) => {
        const deliveredQuantity = Number(line.deliveredQuantity);
        const unitCost = line.unitCost.trim() ? Number(line.unitCost) : null;
        if (!Number.isInteger(deliveredQuantity) || deliveredQuantity < 0)
          throw new Error("Delivered quantities must be whole numbers");
        if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0))
          throw new Error("Unit costs must be non-negative amounts");
        return { restockRequestItemId: line.id, deliveredQuantity, unitCost };
      });
      const response = await apiRequest(
        `/api/restocks/${receiving.id}/receive?branchId=${branchId}`,
        {
          method: "POST",
          body: JSON.stringify({
            reference: receiveReference.trim() || null,
            notes: receiveNotes.trim(),
            items,
          }),
        },
      );
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!active.current) return;
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to receive delivery");
      setReceiving(null);
      setSelected(null);
      onToast("Delivery received and inventory updated");
      await load();
    } catch (error) {
      onToast(errorMessage(error, "Unable to receive delivery"));
    } finally {
      setReceiveSubmitting(false);
    }
  }
  function createFormView() {
    return (
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
          <Button
            type="button"
            variant="secondary"
            disabled={creating}
            onClick={() => setCreateOpen(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={creating}>
            {creating ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    );
  }

  const displayed = visible
    .filter(
      (request) =>
        tab === "history" ||
        (stages.find((item) => item.id === stage) ?? stages[0]).statuses.includes(request.status),
    )
    .sort((a, b) => {
      const priority = (request: Restock) =>
        request.status === "Delivered" ? 0 : request.status === "Shipped" ? 1 : 2;
      return tab === "history" ? b.id - a.id : priority(a) - priority(b) || b.id - a.id;
    });
  const requestRow = (restock: Restock) => (
    <article className="restock-request-row" key={restock.id}>
      <button
        type="button"
        className="restock-request-row__detail"
        onClick={() => setSelected(restock)}
        aria-label={`Open restock request ${restock.id}`}
      >
        <span className="restock-request-identity">
          <small>Request #{restock.id}</small>
          <strong>{restock.supplier_name}</strong>
          <small>{restock.reference || "No reference"}</small>
        </span>
        <span className="restock-request-destination">
          <small className="restock-mobile-label">Branch</small>
          <strong>{restock.branch}</strong>
          <small>
            {new Date(restock.created_at).toLocaleDateString("en-PH", {
              timeZone: "Asia/Manila",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </small>
        </span>
        <span className="restock-request-items">
          <small className="restock-mobile-label">Requested items</small>
          {restock.items.map((item) => (
            <span key={item.id}>
              {item.itemName} <strong>× {item.requestedQuantity}</strong>
            </span>
          ))}
        </span>
        <span className="restock-request-status">
          <Badge tone={statusTone(restock.status)}>{restock.status}</Badge>
        </span>
      </button>
      <div className="restock-request-row__action">
        {restock.status === "Delivered" ? (
          <Button
            size="sm"
            disabled={loading || Boolean(loadError)}
            onClick={() => openReceive(restock)}
          >
            Receive delivery
          </Button>
        ) : ["Pending", "Accepted", "Preparing", "Shipped"].includes(restock.status) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || Boolean(loadError) || markingDelivered !== null}
            onClick={() => setPendingDelivery(restock)}
          >
            Confirm arrival
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setSelected(restock)}>
            View request
          </Button>
        )}
      </div>
    </article>
  );
  return (
    <div className="operational-workspace restock-workspace">
      <PageHeader
        title="Restock requests"
        action={
          <Button icon="plus" disabled={loading || Boolean(loadError)} onClick={openCreate}>
            New request
          </Button>
        }
      >
        <FreshnessBar
          updatedAt={updatedAt}
          loading={loading}
          error={loadError}
          onRefresh={() => void load()}
        />
        {branchControl}
      </PageHeader>
      <Panel className="operational-panel restock-list-panel">
        <div className="restock-list-tabs">
          <Tabs
            active={tab}
            onChange={(value) => {
              setTab(value);
              setStatusFilter("all");
              setStage("all");
            }}
            items={[
              { id: "active", label: "Active requests" },
              { id: "history", label: "Completed / cancelled" },
            ]}
          />
        </div>
        {tab === "active" && (
          <div className="restock-stages" role="group" aria-label="Filter by request stage">
            {stages.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={stage === item.id}
                onClick={() => setStage(item.id)}
              >
                <span>{item.label}</span>
                <strong>
                  {loading || loadError
                    ? "—"
                    : visible.filter((request) => item.statuses.includes(request.status)).length}
                </strong>
              </button>
            ))}
          </div>
        )}
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search supplier, item or request"
          onReset={() => {
            setSearch("");
            setStatusFilter("all");
            setStage("all");
          }}
          filters={
            <SelectField
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {(tab === "history"
                ? ["Received", "Cancelled"]
                : ["Pending", "Accepted", "Preparing", "Shipped", "Delivered"]
              ).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectField>
          }
          resultCount={loading || loadError ? undefined : displayed.length}
        />
        {loading ? (
          <SkeletonRows count={5} label="Loading restock requests" />
        ) : loadError ? (
          <div className="operational-loading" role="alert">
            {loadError}
          </div>
        ) : !displayed.length ? (
          <EmptyState
            icon="box"
            title={
              search || statusFilter !== "all" || stage !== "all"
                ? "No matching requests"
                : tab === "history"
                  ? "No completed requests"
                  : "No active requests"
            }
            description="Change the filters or open the other request view."
          />
        ) : (
          <div className="restock-request-list">
            <div className="restock-list-heading" aria-hidden="true">
              <div>
                <span>Request / supplier</span>
                <span>Branch / requested</span>
                <span>Items</span>
                <span>Status</span>
              </div>
              <span>Next action</span>
            </div>
            {displayed.map(requestRow)}
          </div>
        )}
      </Panel>
      <Modal
        open={createOpen}
        title="Create restock request"
        onClose={() => !creating && setCreateOpen(false)}
      >
        {createFormView()}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected ? `Restock request #${selected.id}` : "Restock request"}
        subtitle={selected ? `${selected.supplier_name} · ${selected.branch}` : undefined}
        eyebrow="Supply workflow"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <DrawerSection>
              <div className="operational-drawer__identity">
                <span className="supplier-card-mark supplier-card-mark--large">
                  <span>#{selected.id}</span>
                </span>
                <div>
                  <strong>{selected.supplier_name}</strong>
                  <span>{selected.reference || "No reference"}</span>
                </div>
                <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
              </div>
            </DrawerSection>
            <DrawerSection eyebrow="Request lines" title="Inventory requested">
              <div className="drawer-mini-list">
                {selected.items.map((item) => (
                  <div key={item.id}>
                    <strong>{item.itemName}</strong>
                    <span>
                      {item.requestedQuantity} requested ·{" "}
                      {item.deliveredQuantity ?? "Not recorded"} delivered
                    </span>
                  </div>
                ))}
              </div>
            </DrawerSection>
            <DrawerSection title="Request notes">
              <p>{selected.notes || "No notes"}</p>
            </DrawerSection>
            <DrawerSection eyebrow="Actions" title="Move this request forward">
              <div className="operational-drawer__actions">
                {["Pending", "Accepted", "Preparing", "Shipped"].includes(selected.status) && (
                  <Button
                    variant="secondary"
                    disabled={markingDelivered === selected.id}
                    onClick={() => setPendingDelivery(selected)}
                  >
                    {markingDelivered === selected.id ? "Confirming…" : "Confirm arrival"}
                  </Button>
                )}
                {selected.status === "Delivered" && (
                  <Button icon="box" onClick={() => openReceive(selected)}>
                    Receive delivery
                  </Button>
                )}
                {!["Received", "Cancelled"].includes(selected.status) && (
                  <Button
                    variant="danger"
                    disabled={cancelling}
                    onClick={() => setPendingCancel(selected)}
                  >
                    Cancel request
                  </Button>
                )}
              </div>
              <ol className="restock-steps" aria-label="Restock steps">
                {["Request sent", "Supplier preparing", "Arrived at branch", "Stock received"].map(
                  (step, index) => {
                    const reached =
                      selected.status === "Cancelled"
                        ? -1
                        : selected.status === "Received"
                          ? 3
                          : selected.status === "Delivered"
                            ? 2
                            : ["Accepted", "Preparing", "Shipped"].includes(selected.status)
                              ? 1
                              : 0;
                    return (
                      <li key={step} className={index <= reached ? "is-done" : ""}>
                        {step}
                      </li>
                    );
                  },
                )}
              </ol>
              <p className="form-hint">
                {selected.status === "Delivered"
                  ? "Count what arrived and record it with Receive delivery. That adds the stock to inventory."
                  : ["Received", "Cancelled"].includes(selected.status)
                    ? "This request is closed and kept for history."
                    : "Suppliers with a portal login update progress themselves. If the goods have already arrived, confirm arrival here, then receive the delivery."}
              </p>
            </DrawerSection>
          </>
        )}
      </DetailDrawer>
      <Modal
        open={Boolean(receiving)}
        title={receiving ? `Receive request #${receiving.id}` : "Receive delivery"}
        onClose={() => !receiveSubmitting && setReceiving(null)}
      >
        <form className="modal-form" onSubmit={receive}>
          {receiving?.items.map((item) => {
            const line = receiveLines.find((entry) => entry.id === item.id);
            return (
              <div className="form-grid form-grid--two" key={item.id}>
                <TextField
                  label={`${item.itemName} delivered`}
                  type="number"
                  min="0"
                  step="1"
                  value={line?.deliveredQuantity ?? "0"}
                  onChange={(event) =>
                    setReceiveLines((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, deliveredQuantity: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <TextField
                  label="Unit cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line?.unitCost ?? ""}
                  onChange={(event) =>
                    setReceiveLines((current) =>
                      current.map((entry) =>
                        entry.id === item.id ? { ...entry, unitCost: event.target.value } : entry,
                      ),
                    )
                  }
                />
              </div>
            );
          })}
          <TextField
            label="Reference number"
            value={receiveReference}
            onChange={(event) => setReceiveReference(event.target.value)}
          />
          <TextField
            label="Notes"
            value={receiveNotes}
            onChange={(event) => setReceiveNotes(event.target.value)}
          />
          <p className="form-hint">
            Receiving updates every line transactionally and cannot be repeated.
          </p>
          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={receiveSubmitting}
              onClick={() => setReceiving(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={receiveSubmitting}>
              {receiveSubmitting ? "Receiving…" : "Confirm receiving"}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title="Cancel this restock request?"
        description={
          pendingCancel
            ? `Request #${pendingCancel.id} · ${pendingCancel.supplier_name}. No stock will be added.`
            : undefined
        }
        confirmLabel="Cancel request"
        danger
        busy={cancelling}
        onClose={() => setPendingCancel(null)}
        onConfirm={() => {
          const request = pendingCancel;
          setPendingCancel(null);
          if (request) void cancelRequest(request);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelivery)}
        title="Confirm this shipment arrived?"
        description={
          pendingDelivery
            ? `Request #${pendingDelivery.id} · ${pendingDelivery.supplier_name} · ${pendingDelivery.branch}`
            : undefined
        }
        confirmLabel="Mark delivered"
        busy={markingDelivered !== null}
        onClose={() => setPendingDelivery(null)}
        onConfirm={() => {
          const request = pendingDelivery;
          setPendingDelivery(null);
          if (request) void markDelivered(request);
        }}
      />
    </div>
  );
}
