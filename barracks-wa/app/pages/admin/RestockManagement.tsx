"use client";
import { ListPageSkeleton, SkeletonRows } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Panel,
  SelectField,
  Tabs,
} from "@/app/components/ui";
import { FreshnessBar, FilterToolbar } from "@/app/components/operations/OperationalPrimitives";
import { CreateRestockDialog } from "./restock/CreateRestockDialog";
import { stages, type Restock } from "./restock/model";
import { ReceiveDialog } from "./restock/ReceiveDialog";
import { RestockDrawer } from "./restock/RestockDrawer";
import { RestockRequestRow } from "./restock/RestockRequestRow";

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
  const [receiving, setReceiving] = useState<Restock | null>(null);
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
  return (
    <div className="operational-workspace restock-workspace">
      <PageHeader
        title="Restock requests"
        action={
          <Button
            icon="plus"
            disabled={loading || Boolean(loadError)}
            onClick={() => setCreateOpen(true)}
          >
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
            {displayed.map((restock) => (
              <RestockRequestRow
                key={restock.id}
                restock={restock}
                actionsDisabled={loading || Boolean(loadError)}
                confirmDisabled={loading || Boolean(loadError) || markingDelivered !== null}
                onOpen={() => setSelected(restock)}
                onReceive={() => setReceiving(restock)}
                onConfirmArrival={() => setPendingDelivery(restock)}
              />
            ))}
          </div>
        )}
      </Panel>
      {createOpen && (
        <CreateRestockDialog
          branchId={branchId}
          branchName={branchName}
          suppliers={suppliers}
          inventory={inventory}
          onToast={onToast}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            onToast("Restock request sent to supplier");
            void load();
          }}
        />
      )}
      <RestockDrawer
        selected={selected}
        markingDelivered={markingDelivered}
        cancelling={cancelling}
        onClose={() => setSelected(null)}
        onConfirmArrival={setPendingDelivery}
        onReceive={setReceiving}
        onCancel={setPendingCancel}
      />
      {receiving && (
        <ReceiveDialog
          restock={receiving}
          branchId={branchId}
          onToast={onToast}
          onClose={() => setReceiving(null)}
          onReceived={() => {
            setReceiving(null);
            setSelected(null);
            onToast("Delivery received and inventory updated");
            void load();
          }}
        />
      )}
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
