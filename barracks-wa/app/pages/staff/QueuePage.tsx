"use client";
import { ListPageSkeleton, SkeletonCards, SkeletonRows } from "@/app/components/ui/Skeletons";
import { phoneFieldError } from "@/app/utils/contact-validation";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiBarberAvailability, ApiCustomer, ApiQueueEntry } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import type { Service } from "@/app/types/domain";
import { createInitials } from "@/app/utils/format";
import { barberAvailabilityLabel, isBarberAvailable } from "@/app/utils/barber-availability";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";
import {
  DetailDrawer,
  DrawerSection,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";

const statusLabel = (status: ApiQueueEntry["status"]) =>
  ({
    waiting: "Waiting",
    ready: "Ready",
    in_progress: "In progress",
    completed: "Completed",
    removed: "Removed",
  })[status];
const waitMinutes = (entry: ApiQueueEntry) =>
  Math.max(0, Math.floor((Date.now() - new Date(entry.joinedAt).getTime()) / 60_000));
const manilaTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const visitLabel = (entry: ApiQueueEntry) =>
  entry.visitType === "appointment" ? "Appointment" : "Walk-in";
const scheduledTime = (entry: ApiQueueEntry) => {
  if (!entry.scheduledTime) return null;
  const [hours, minutes] = entry.scheduledTime.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};

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
  const [completed, setCompleted] = useState<ApiQueueEntry[]>([]);
  const [queueTab, setQueueTab] = useState<"active" | "completed-today">("active");
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedError, setCompletedError] = useState("");
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<ApiQueueEntry | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ApiQueueEntry | null>(null);
  const [nextBarberId, setNextBarberId] = useState("");
  const [nextEntry, setNextEntry] = useState<ApiQueueEntry | null>(null);
  const [nextMessage, setNextMessage] = useState("");
  const [nextBusy, setNextBusy] = useState(false);
  const [draft, setDraft] = useState({ customerId: "", serviceId: "", barberId: "" });
  const [newCustomer, setNewCustomer] = useState({ firstName: "", lastName: "", phone: "" });
  const submissionKey = useRef<string | null>(null);
  const addInFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [queueResponse, customerResponse, serviceResponse, barberResponse] =
          await Promise.all([
            apiRequest(`/api/queue?view=active&branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/customers", { cache: "no-store", reuseForMs: 15_000 }),
            apiRequest("/api/services", { cache: "no-store", reuseForMs: 15_000 }),
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
        setDraft({
          customerId: String(customerData.customers?.[0]?.id ?? ""),
          serviceId: serviceData.services?.find((service) => service.active)?.id ?? "",
          barberId: "",
        });
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load queue");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [branchId]);

  useEffect(() => {
    if (queueTab !== "completed-today") return;
    let active = true;
    async function loadCompleted() {
      setCompletedLoading(true);
      setCompletedError("");
      try {
        const response = await apiRequest(`/api/queue?view=completed-today&branchId=${branchId}`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          queue?: ApiQueueEntry[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !body.queue)
          throw new Error(body?.message ?? "Unable to load completed queue");
        if (active) setCompleted(body.queue);
      } catch (cause) {
        if (active)
          setCompletedError(
            cause instanceof Error ? cause.message : "Unable to load completed queue",
          );
      } finally {
        if (active) setCompletedLoading(false);
      }
    }
    void loadCompleted();
    return () => {
      active = false;
    };
  }, [queueTab, branchId]);

  const visible = useMemo(
    () =>
      (queueTab === "active" ? queue : completed).filter(
        (entry) =>
          (queueTab === "completed-today" ||
            statusFilter === "all" ||
            entry.status === statusFilter) &&
          `${entry.customerName} ${entry.serviceName} ${entry.barberName ?? ""}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [queue, completed, queueTab, search, statusFilter],
  );
  const active = queue;
  const averageWait = active.length
    ? Math.round(active.reduce((sum, entry) => sum + waitMinutes(entry), 0) / active.length)
    : 0;
  const availableBarbers = barbers.filter(isBarberAvailable);
  const selectedBarber = barbers.find((barber) => barber.id === selected?.barberId);
  const selectedBarberAvailable = Boolean(selectedBarber && isBarberAvailable(selectedBarber));

  async function refreshAvailability() {
    setBarbers([]);
    setNextEntry(null);
    setNextMessage("");
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
      onToast(cause instanceof Error ? cause.message : "Unable to refresh barber availability");
    }
  }

  function openAddDialog() {
    setDraft({
      customerId: customers[0] ? String(customers[0].id) : "new",
      serviceId: services.find((service) => service.active)?.id ?? "",
      barberId: "",
    });
    setNewCustomer({ firstName: "", lastName: "", phone: "" });
    submissionKey.current = globalThis.crypto.randomUUID();
    setAddOpen(true);
  }

  function closeAddDialog() {
    if (addInFlight.current) return;
    submissionKey.current = null;
    setAddOpen(false);
  }

  async function addWalkIn(event: FormEvent) {
    event.preventDefault();
    if (addInFlight.current || !draft.customerId || !draft.serviceId) return;
    addInFlight.current = true;
    const idempotencyKey = submissionKey.current ?? globalThis.crypto.randomUUID();
    submissionKey.current = idempotencyKey;
    setBusy(true);
    try {
      const payload = {
        ...(draft.customerId === "new"
          ? {
              customer: {
                firstName: newCustomer.firstName,
                lastName: newCustomer.lastName,
                phone: newCustomer.phone,
              },
            }
          : { customerId: Number(draft.customerId) }),
        serviceId: draft.serviceId,
        barberId: draft.barberId ? Number(draft.barberId) : null,
        idempotencyKey,
      };
      const response = await apiRequest(`/api/queue?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await readApiBody<{ success: boolean; entry?: ApiQueueEntry; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.entry)
        throw new Error(body?.message ?? "Unable to add walk-in");
      setQueue((current) => [...current, body.entry!]);
      setNextEntry(null);
      setNextMessage("");
      submissionKey.current = null;
      setAddOpen(false);
      onToast("Walk-in added to the queue");
      if (draft.customerId === "new") {
        try {
          const customerResponse = await apiRequest("/api/customers", {
            cache: "no-store",
            reuseForMs: 15_000,
          });
          const customerBody = await readApiBody<{ success: boolean; customers?: ApiCustomer[] }>(
            customerResponse,
          );
          if (customerResponse.ok && customerBody?.success && customerBody.customers)
            setCustomers(customerBody.customers);
        } catch {
          /* The queue entry is already committed; reload customers next time. */
        }
      }
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to add walk-in");
    } finally {
      addInFlight.current = false;
      setBusy(false);
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
      setNextEntry(null);
      setNextMessage("");
      setSelected(["removed", "completed"].includes(body.entry.status) ? null : body.entry);
      setPendingRemove(null);
      onToast("Queue updated");
      await refreshAvailability();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to update queue");
    } finally {
      setBusy(false);
    }
  }

  async function suggestNext() {
    if (!nextBarberId) return;
    setNextBusy(true);
    setNextEntry(null);
    setNextMessage("");
    try {
      const response = await apiRequest(
        `/api/queue/next?barberId=${nextBarberId}&branchId=${branchId}`,
        { cache: "no-store" },
      );
      const body = await readApiBody<{
        success: boolean;
        entry?: ApiQueueEntry | null;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to find next customer");
      setNextEntry(body.entry ?? null);
      if (!body.entry)
        setNextMessage(body.message ?? "No eligible customer is waiting for this barber.");
    } catch (cause) {
      setNextMessage(cause instanceof Error ? cause.message : "Unable to find next customer");
    } finally {
      setNextBusy(false);
    }
  }

  async function confirmNextAssignment() {
    if (!nextEntry || !nextBarberId || nextEntry.status !== "waiting") return;
    setNextBusy(true);
    try {
      const response = await apiRequest(`/api/queue/next?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify({ barberId: Number(nextBarberId), entryId: nextEntry.id }),
      });
      const body = await readApiBody<{ success: boolean; entry?: ApiQueueEntry; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.entry)
        throw new Error(body?.message ?? "Unable to assign next customer");
      setQueue((current) =>
        current.map((entry) => (entry.id === body.entry!.id ? body.entry! : entry)),
      );
      setNextEntry(body.entry);
      setNextMessage("");
      setSelected(body.entry);
      onToast("Barber assigned. Start service when ready.");
    } catch (cause) {
      setNextEntry(null);
      setNextMessage(cause instanceof Error ? cause.message : "Unable to assign next customer");
    } finally {
      setNextBusy(false);
    }
  }

  const tone = (status: ApiQueueEntry["status"]) =>
    status === "ready" || status === "completed"
      ? "success"
      : status === "in_progress"
        ? "info"
        : "neutral";
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
                onClick={openAddDialog}
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
          <Panel className="queue-next-panel">
            <div className="inventory-catalog-head">
              <div>
                <span className="inventory-kicker">Front desk</span>
                <h2>Next Customer</h2>
                <p>Choose an available barber, then review the suggested customer.</p>
              </div>
            </div>
            <div className="queue-next__body">
              <div className="queue-next__controls">
                <SelectField
                  label="Barber"
                  value={nextBarberId}
                  disabled={nextBusy}
                  onChange={(event) => {
                    setNextBarberId(event.target.value);
                    setNextEntry(null);
                    setNextMessage("");
                  }}
                >
                  <option value="">Select barber</option>
                  {availableBarbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.firstName} {barber.lastName}
                    </option>
                  ))}
                </SelectField>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !availableBarbers.some((barber) => String(barber.id) === nextBarberId) ||
                    nextBusy ||
                    loading
                  }
                  onClick={() => void suggestNext()}
                >
                  {nextBusy ? "Checking…" : "Next Customer"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || nextBusy || loading}
                  onClick={() => void refreshAvailability()}
                >
                  Refresh availability
                </Button>
              </div>
              {nextMessage && (
                <p className="queue-next__message" role="status">
                  {nextMessage}
                </p>
              )}
              {nextEntry && (
                <div
                  className="queue-next__suggestion"
                  role="region"
                  aria-label="Suggested next customer"
                >
                  <div>
                    <strong>{nextEntry.customerName}</strong>
                    <span>
                      {nextEntry.serviceName} ·{" "}
                      {nextEntry.visitType === "appointment" ? "Checked-in appointment" : "Walk-in"}
                    </span>
                    <span className="queue-visit-type">
                      <Badge tone={nextEntry.visitType === "appointment" ? "info" : "neutral"}>
                        {visitLabel(nextEntry)}
                      </Badge>
                      {scheduledTime(nextEntry) && <span>• {scheduledTime(nextEntry)}</span>}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Joined / checked in</dt>
                      <dd>
                        {new Date(nextEntry.joinedAt).toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>Current barber</dt>
                      <dd>{nextEntry.barberName ?? "Unassigned"}</dd>
                    </div>
                  </dl>
                  {nextEntry.status === "waiting" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={nextBusy}
                      onClick={() => void confirmNextAssignment()}
                    >
                      Assign barber
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelected(nextEntry)}
                    >
                      Open queue entry
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Panel>
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
            ) : view === "cards" ? (
              <div className="operational-card-grid">
                {visible.map((entry) => (
                  <RecordCard
                    key={entry.id}
                    onOpen={() => openEntry(entry)}
                    ariaLabel={`Open queue entry for ${entry.customerName}`}
                  >
                    <div className="operational-card__header">
                      <div className="operational-card__identity">
                        <Avatar
                          initials={createInitials(entry.customerName)}
                          tone="slate"
                          size="md"
                        />
                        <div>
                          <strong>{entry.customerName}</strong>
                          <small>
                            Queue #{entry.id}
                            {entry.bookingId !== null && ` · Booking #${entry.bookingId}`}
                          </small>
                        </div>
                      </div>
                      <Badge tone={tone(entry.status)}>{statusLabel(entry.status)}</Badge>
                    </div>
                    <div className="queue-visit-type">
                      <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                        {visitLabel(entry)}
                      </Badge>
                      {scheduledTime(entry) && <span>• {scheduledTime(entry)}</span>}
                    </div>
                    <p className="operational-card__note">
                      {entry.serviceName} · {entry.barberName ?? "Awaiting barber"}
                    </p>
                    <div className="operational-card__facts">
                      <div>
                        <span>Joined</span>
                        <strong>
                          {new Date(entry.joinedAt).toLocaleTimeString("en-PH", {
                            timeZone: "Asia/Manila",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </strong>
                      </div>
                      <div>
                        <span>Wait</span>
                        <strong>
                          {entry.status === "completed" ? "—" : `${waitMinutes(entry)}m`}
                        </strong>
                      </div>
                    </div>
                  </RecordCard>
                ))}
              </div>
            ) : (
              <ResponsiveTable
                headers={["#", "Customer", "Type", "Service", "Barber", "Status", "Wait"]}
              >
                {visible.map((entry) => (
                  <tr
                    key={entry.id}
                    tabIndex={0}
                    onClick={() => openEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openEntry(entry);
                    }}
                  >
                    <td>{entry.id}</td>
                    <td>{entry.customerName}</td>
                    <td>
                      <span className="queue-visit-type">
                        <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                          {visitLabel(entry)}
                        </Badge>
                        {scheduledTime(entry) && <span>• {scheduledTime(entry)}</span>}
                      </span>
                    </td>
                    <td>{entry.serviceName}</td>
                    <td>{entry.barberName ?? "Unassigned"}</td>
                    <td>
                      <Badge tone={tone(entry.status)}>{statusLabel(entry.status)}</Badge>
                    </td>
                    <td>{entry.status === "completed" ? "—" : `${waitMinutes(entry)}m`}</td>
                  </tr>
                ))}
              </ResponsiveTable>
            )}
          </Panel>
        </>
      )}
      {queueTab === "completed-today" && (
        <div role="tabpanel">
          <Panel className="operational-panel">
            <div className="inventory-catalog-head">
              <div>
                <span className="inventory-kicker">Today in Manila</span>
                <h2>Completed Today</h2>
                <p>Finished services are read-only.</p>
              </div>
            </div>
            <FilterToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search completed services"
              resultCount={visible.length}
            />
            {completedLoading ? (
              <SkeletonRows count={3} label="Loading completed services" />
            ) : completedError ? (
              <p role="alert">{completedError}</p>
            ) : !visible.length ? (
              <EmptyState
                icon="queue"
                title="No completed services today"
                description="Finished services will appear here."
              />
            ) : (
              <ResponsiveTable
                headers={["Customer", "Service", "Barber", "Type", "Started", "Completed"]}
              >
                {visible.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.customerName}</td>
                    <td>{entry.serviceName}</td>
                    <td>{entry.barberName ?? "Unassigned"}</td>
                    <td>
                      <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                        {visitLabel(entry)}
                      </Badge>
                    </td>
                    <td>{manilaTime(entry.startedAt)}</td>
                    <td>{manilaTime(entry.completedAt)}</td>
                  </tr>
                ))}
              </ResponsiveTable>
            )}
          </Panel>
        </div>
      )}
      <Modal
        open={addOpen}
        title="Add to queue"
        description="Choose an existing customer or add a walk-in record."
        onClose={closeAddDialog}
      >
        <form className="modal-form" onSubmit={addWalkIn}>
          <SelectField
            label="Customer"
            required
            disabled={busy}
            value={draft.customerId}
            onChange={(event) => {
              submissionKey.current = globalThis.crypto.randomUUID();
              setDraft({ ...draft, customerId: event.target.value });
            }}
          >
            <option value="">Select customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.firstName} {customer.lastName}
              </option>
            ))}
            <option value="new">New Walk-In Customer</option>
          </SelectField>
          {draft.customerId === "new" && (
            <>
              <TextField
                label="First name"
                required
                disabled={busy}
                autoComplete="given-name"
                value={newCustomer.firstName}
                onChange={(event) => {
                  submissionKey.current = globalThis.crypto.randomUUID();
                  setNewCustomer((current) => ({ ...current, firstName: event.target.value }));
                }}
              />
              <TextField
                label="Last name"
                required
                disabled={busy}
                autoComplete="family-name"
                value={newCustomer.lastName}
                onChange={(event) => {
                  submissionKey.current = globalThis.crypto.randomUUID();
                  setNewCustomer((current) => ({ ...current, lastName: event.target.value }));
                }}
              />
              <TextField
                label="Phone number (optional)"
                type="tel"
                inputMode="tel"
                maxLength={11}
                disabled={busy}
                value={newCustomer.phone}
                error={phoneFieldError(newCustomer.phone)}
                onChange={(event) => {
                  submissionKey.current = globalThis.crypto.randomUUID();
                  setNewCustomer((current) => ({ ...current, phone: event.target.value }));
                }}
              />
            </>
          )}
          <SelectField
            label="Service"
            required
            disabled={busy}
            value={draft.serviceId}
            onChange={(event) => {
              submissionKey.current = globalThis.crypto.randomUUID();
              setDraft({ ...draft, serviceId: event.target.value });
            }}
          >
            {services
              .filter((service) => service.active)
              .map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {service.durationMinutes} min
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Barber (optional)"
            disabled={busy}
            value={draft.barberId}
            onChange={(event) => {
              submissionKey.current = globalThis.crypto.randomUUID();
              setDraft({ ...draft, barberId: event.target.value });
            }}
          >
            <option value="">Unassigned</option>
            {availableBarbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.firstName} {barber.lastName}
              </option>
            ))}
          </SelectField>
          <div className="modal-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={closeAddDialog}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add to queue"}
            </Button>
          </div>
        </form>
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected?.customerName ?? "Queue entry"}
        subtitle={selected ? `${selected.serviceName} · Queue #${selected.id}` : undefined}
        eyebrow="Live queue"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <DrawerSection>
              <div className="operational-drawer__identity">
                <Avatar initials={createInitials(selected.customerName)} tone="slate" size="lg" />
                <div>
                  <strong>{selected.serviceName}</strong>
                  <span>
                    {selected.bookingId !== null ? `Booking #${selected.bookingId}` : "Walk-in"}
                  </span>
                  <span className="queue-visit-type">
                    <Badge tone={selected.visitType === "appointment" ? "info" : "neutral"}>
                      {visitLabel(selected)}
                    </Badge>
                    {scheduledTime(selected) && <span>• {scheduledTime(selected)}</span>}
                  </span>
                </div>
                <Badge tone={tone(selected.status)}>{statusLabel(selected.status)}</Badge>
              </div>
            </DrawerSection>
            <DrawerSection eyebrow="Assignment" title="Floor handoff">
              <div className="operational-drawer__rows">
                <div className="operational-drawer__row">
                  <span>Assigned barber</span>
                  {selected.bookingId === null && ["waiting", "ready"].includes(selected.status) ? (
                    <select
                      className="table-select"
                      value={selected.barberId ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        void change(selected, {
                          barberId: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {selectedBarber && !selectedBarberAvailable && (
                        <option value={selectedBarber.id} disabled>
                          {selectedBarber.firstName} {selectedBarber.lastName} ·{" "}
                          {barberAvailabilityLabel(selectedBarber)}
                        </option>
                      )}
                      {availableBarbers.map((barber) => (
                        <option key={barber.id} value={barber.id}>
                          {barber.firstName} {barber.lastName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <strong>{selected.barberName ?? "Unassigned"}</strong>
                  )}
                </div>
                {selected.visitType === "appointment" && (
                  <>
                    <div className="operational-drawer__row">
                      <span>Scheduled</span>
                      <strong>
                        {selected.scheduledDate} {scheduledTime(selected)}
                      </strong>
                    </div>
                    <div className="operational-drawer__row">
                      <span>Booking status</span>
                      <strong>{selected.bookingStatus?.replaceAll("_", " ") ?? "—"}</strong>
                    </div>
                  </>
                )}
              </div>
            </DrawerSection>
            {selected.visitType === "appointment" && (
              <DrawerSection>
                <p>Manage appointment service from Bookings.</p>
              </DrawerSection>
            )}
            {selected.visitType === "walk_in" &&
              !["completed", "removed"].includes(selected.status) && (
                <DrawerSection eyebrow="Queue actions" title="Move customer forward">
                  <div className="operational-drawer__actions">
                    {selected.status === "ready" && (
                      <>
                        <Button
                          disabled={busy || !selectedBarberAvailable}
                          onClick={() => void change(selected, { status: "in_progress" })}
                        >
                          Start Service
                        </Button>
                        {!selectedBarberAvailable && (
                          <p role="status">
                            {selectedBarber
                              ? barberAvailabilityLabel(selectedBarber)
                              : "Refresh barber availability before starting."}{" "}
                            Service timing is checked again when you start.
                          </p>
                        )}
                      </>
                    )}
                    {selected.status === "in_progress" && (
                      <Button
                        disabled={busy}
                        onClick={() => void change(selected, { status: "completed" })}
                      >
                        Complete
                      </Button>
                    )}
                    {selected.bookingId === null &&
                      ["waiting", "ready"].includes(selected.status) && (
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => setPendingRemove(selected)}
                        >
                          Remove
                        </Button>
                      )}
                  </div>
                </DrawerSection>
              )}
          </>
        )}
      </DetailDrawer>
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
