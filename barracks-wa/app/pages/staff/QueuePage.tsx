"use client";
import { ListPageSkeleton, SkeletonCards } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiBarberAvailability, ApiCustomer, ApiQueueEntry } from "@/app/lib/api";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import type { Service } from "@/app/types/domain";
import { isBarberAvailable } from "@/app/utils/barber-availability";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  SelectField,
} from "@/app/components/ui";
import {
  FilterToolbar,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";
import { AddToQueueDialog } from "./queue/AddToQueueDialog";
import { CompletedTodayPanel } from "./queue/CompletedTodayPanel";
import { matchesSearch, statusLabel, waitMinutes } from "./queue/model";
import { NextCustomerPanel } from "./queue/NextCustomerPanel";
import { QueueEntries } from "./queue/QueueEntries";
import { QueueEntryDrawer } from "./queue/QueueEntryDrawer";
import { useNextCustomer } from "./queue/useNextCustomer";

export function QueuePage({ onToast }: { onToast: (message: string) => void }) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = useBranchContext();
  const branchControl = (
    <BranchSwitcher
      branches={branches}
      value={branchId}
      loading={branchLoading}
      onChange={setBranchId}
    />
  );
  if (branchId > 0)
    return (
      <QueuePageContent
        key={branchId}
        branchId={branchId}
        onToast={onToast}
        branchControl={branchControl}
      />
    );
  if (branchLoading && !branchError) return <ListPageSkeleton label="Loading queue" />;
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

function QueuePageContent({
  onToast,
  branchId,
  branchControl,
}: {
  branchControl: ReactNode;
  branchId: number;
  onToast: (message: string) => void;
}) {
  const [queue, setQueue] = useState<ApiQueueEntry[]>([]);
  const [queueTab, setQueueTab] = useState<"active" | "completed-today">("active");
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<ApiQueueEntry | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ApiQueueEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = useNextCustomer(branchId, (entry) => {
    setQueue((current) => current.map((item) => (item.id === entry.id ? entry : item)));
    setSelected(entry);
    onToast("Barber assigned. Start service when ready.");
  });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [queueResponse, customerResponse, serviceResponse, barberResponse] =
          await Promise.all([
            apiRequest(`/api/queue?view=active&branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/customers", { cache: "no-store" }),
            apiRequest("/api/services", { cache: "no-store" }),
            apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" }),
          ]);
        const [queueData, customerData, serviceData, barberData] = await Promise.all([
          readApiBody<{ success: boolean; queue?: ApiQueueEntry[]; message?: string }>(
            queueResponse,
          ),
          readApiBody<{ success: boolean; customers?: ApiCustomer[]; message?: string }>(
            customerResponse,
          ),
          readApiBody<{ success: boolean; services?: Service[]; message?: string }>(
            serviceResponse,
          ),
          readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[]; message?: string }>(
            barberResponse,
          ),
        ]);
        if (
          !queueResponse.ok ||
          !queueData?.success ||
          !customerResponse.ok ||
          !customerData?.success ||
          !serviceResponse.ok ||
          !serviceData?.success ||
          !barberResponse.ok ||
          !barberData?.success
        ) {
          throw new Error(
            queueData?.message ??
              customerData?.message ??
              serviceData?.message ??
              barberData?.message ??
              "Unable to load queue",
          );
        }
        if (!active) return;
        setQueue(queueData.queue ?? []);
        setCustomers(customerData.customers ?? []);
        setServices(serviceData.services ?? []);
        setBarbers(barberData.barbers ?? []);
        setError("");
      } catch (cause) {
        if (active) setError(errorMessage(cause, "Unable to load queue"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [branchId]);

  const visible = useMemo(
    () =>
      queue.filter(
        (entry) =>
          (statusFilter === "all" || entry.status === statusFilter) && matchesSearch(entry, search),
      ),
    [queue, search, statusFilter],
  );
  const active = queue;
  const averageWait = active.length
    ? Math.round(active.reduce((sum, entry) => sum + waitMinutes(entry), 0) / active.length)
    : 0;
  const availableBarbers = barbers.filter(isBarberAvailable);

  async function refreshAvailability() {
    setBarbers([]);
    next.reset();
    try {
      const response = await apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" });
      const body = await readApiBody<{
        success: boolean;
        barbers?: ApiBarberAvailability[];
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.barbers)
        throw new Error(body?.message ?? "Unable to refresh barber availability");
      setBarbers(body.barbers);
    } catch (cause) {
      onToast(errorMessage(cause, "Unable to refresh barber availability"));
    }
  }

  async function reloadCustomers() {
    try {
      const response = await apiRequest("/api/customers", { cache: "no-store" });
      const body = await readApiBody<{ success: boolean; customers?: ApiCustomer[] }>(response);
      if (response.ok && body?.success && body.customers) setCustomers(body.customers);
    } catch {
      /* The queue entry is already committed; reload customers next time. */
    }
  }

  async function change(
    entry: ApiQueueEntry,
    payload: { barberId: number | null } | { status: ApiQueueEntry["status"] },
    remove = false,
  ) {
    setBusy(true);
    try {
      const response = await apiRequest(`/api/queue/${entry.id}`, {
        method: remove ? "DELETE" : "PATCH",
        body: remove ? undefined : JSON.stringify(payload),
      });
      const body = await readApiBody<{ success: boolean; entry?: ApiQueueEntry; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.entry)
        throw new Error(body?.message ?? "Unable to update queue");
      setQueue((current) =>
        ["removed", "completed"].includes(body.entry!.status)
          ? current.filter((item) => item.id !== entry.id)
          : current.map((item) => (item.id === entry.id ? body.entry! : item)),
      );
      next.reset();
      setSelected(["removed", "completed"].includes(body.entry.status) ? null : body.entry);
      setPendingRemove(null);
      onToast("Queue updated");
      await refreshAvailability();
    } catch (cause) {
      onToast(errorMessage(cause, "Unable to update queue"));
    } finally {
      setBusy(false);
    }
  }

  const openEntry = (entry: ApiQueueEntry) => setSelected(entry);
  return (
    <div className="operational-workspace">
      <PageHeader
        title="Queue management"
        action={
          queueTab === "active" ? (
            <>
              <ViewToggle view={view} onChange={setView} label="Choose queue view" />
              <Button
                icon="plus"
                disabled={loading || !services.some((service) => service.active)}
                onClick={() => setAddOpen(true)}
              >
                Add to queue
              </Button>
            </>
          ) : undefined
        }
      >
        {branchControl}
      </PageHeader>
      <div role="tablist" aria-label="Queue sections" className="queue-section-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={queueTab === "active"}
          onClick={() => {
            setQueueTab("active");
            setSelected(null);
          }}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={queueTab === "completed-today"}
          onClick={() => {
            setQueueTab("completed-today");
            setSelected(null);
          }}
        >
          Completed Today
        </button>
      </div>
      {queueTab === "active" && (
        <>
          <div className="metrics-grid metrics-grid--three">
            <MetricCard
              label="Total in queue"
              value={String(active.length)}
              icon="queue"
              accent="blue"
            />
            <MetricCard
              label="Being served"
              value={String(active.filter((entry) => entry.status === "in_progress").length)}
              icon="scissors"
              accent="amber"
            />
            <MetricCard
              label="Average wait"
              value={`${averageWait}m`}
              icon="clock"
              accent="green"
            />
          </div>
          <NextCustomerPanel
            next={next}
            availableBarbers={availableBarbers}
            loading={loading}
            busy={busy}
            onRefreshAvailability={() => void refreshAvailability()}
            onOpenEntry={setSelected}
          />
          <Panel className="operational-panel">
            <div className="inventory-catalog-head">
              <div>
                <span className="inventory-kicker">Live floor</span>
                <h2>Current queue</h2>
                <p>Open an entry to assign a barber or move it forward.</p>
              </div>
            </div>
            <FilterToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search queue"
              filters={
                <SelectField
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter queue by status"
                >
                  <option value="all">All statuses</option>
                  {(["waiting", "ready", "in_progress"] as const).map((status) => (
                    <option value={status} key={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </SelectField>
              }
              resultCount={visible.length}
            />
            {loading ? (
              <SkeletonCards label="Loading queue" />
            ) : error ? (
              <p role="alert">{error}</p>
            ) : !visible.length ? (
              <EmptyState
                icon="queue"
                title="Queue is empty"
                description="Check in an appointment or add a walk-in."
              />
            ) : (
              <QueueEntries entries={visible} view={view} onOpen={openEntry} />
            )}
          </Panel>
        </>
      )}
      {queueTab === "completed-today" && (
        <div role="tabpanel">
          <CompletedTodayPanel branchId={branchId} search={search} onSearchChange={setSearch} />
        </div>
      )}
      {addOpen && (
        <AddToQueueDialog
          branchId={branchId}
          customers={customers}
          services={services}
          availableBarbers={availableBarbers}
          onToast={onToast}
          onClose={() => setAddOpen(false)}
          onAdded={(entry, createdCustomer) => {
            setQueue((current) => [...current, entry]);
            next.reset();
            setAddOpen(false);
            onToast("Walk-in added to the queue");
            if (createdCustomer) void reloadCustomers();
          }}
        />
      )}
      <QueueEntryDrawer
        selected={selected}
        barbers={barbers}
        busy={busy}
        onClose={() => setSelected(null)}
        onChange={change}
        onRemove={setPendingRemove}
      />
      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Remove this queue entry?"
        confirmLabel="Remove from queue"
        danger
        busy={busy}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && void change(pendingRemove, { status: "removed" }, true)}
      />
    </div>
  );
}
