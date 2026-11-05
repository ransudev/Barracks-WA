"use client";
import { SkeletonCards } from "@/app/components/ui/Skeletons";

import Link from "next/link";
import { payrollMoney } from "@/app/utils/payroll";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import type { ApiBarber } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { createInitials, formatCurrency } from "@/app/utils/format";
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
import { Icon } from "@/app/components/ui/icons";
import { ScheduleManagement } from "@/app/pages/admin/ScheduleManagement";
import {
  DetailDrawer,
  DrawerSection,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";

type BarberForm = {
  branchId: number;
  firstName: string;
  lastName: string;
  status: ApiBarber["status"];
  commissionRate: string;
  rating: string;
};
const emptyForm: BarberForm = {
  branchId: 0,
  firstName: "",
  lastName: "",
  status: "available",
  commissionRate: "",
  rating: "",
};
function displayName(barber: ApiBarber) {
  return `${barber.firstName} ${barber.lastName}`.trim();
}
function statusLabel(status: ApiBarber["status"]) {
  return status === "available" ? "Available" : status === "busy" ? "Busy" : "Unavailable";
}
function statusTone(status: ApiBarber["status"]): "success" | "warning" | "neutral" {
  return status === "available" ? "success" : status === "busy" ? "warning" : "neutral";
}
function barberCommission(barber: ApiBarber) {
  return barber.earnedCommissionCentavos ?? "0";
}
function responseMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
) {
  return body?.errors
    ? Object.values(body.errors).flat().join(" ") || body?.message || fallback
    : body?.message || fallback;
}

export function BarbersManagement({
  onToast,
  canDelete,
  canEditCommission,
}: {
  onToast: (message: string) => void;
  canDelete: boolean;
  canEditCommission: boolean;
  canSetAllCommissions: boolean;
}) {
  const { branches, branchId, setBranchId, branchError } = useBranchContext();
  const loadVersion = useRef(0);
  const invalidateLoad = useCallback(() => {
    ++loadVersion.current;
  }, []);
  const [items, setItems] = useState<ApiBarber[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ApiBarber["status"]>("all");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<ApiBarber | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BarberForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ApiBarber | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const loadBarbers = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!branchId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" });
      const body = await readApiBody<{ success: boolean; barbers?: ApiBarber[]; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.barbers)
        throw new Error(body?.message ?? "Unable to load barbers");
      if (version !== loadVersion.current) return;
      setItems(body.barbers);
      setLoadError("");
    } catch (error) {
      if (version !== loadVersion.current) return;
      const message = error instanceof Error ? error.message : "Unable to load barbers";
      setLoadError(message);
      onToast(message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [onToast, branchId]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadBarbers();
    });
    return () => {
      invalidateLoad();
      window.cancelAnimationFrame(frame);
    };
  }, [loadBarbers, invalidateLoad]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...items]
      .filter(
        (barber) =>
          `${displayName(barber)} ${barber.status}`.toLowerCase().includes(query) &&
          (statusFilter === "all" || barber.status === statusFilter),
      )
      .sort((a, b) =>
        sort === "revenue"
          ? b.revenue - a.revenue
          : sort === "services"
            ? b.servicesDone - a.servicesDone
            : displayName(a).localeCompare(displayName(b)),
      );
  }, [items, search, sort, statusFilter]);
  const dirty = Boolean(
    selected &&
    editing &&
    JSON.stringify(form) !==
      JSON.stringify({
        branchId: selected.branchId,
        firstName: selected.firstName,
        lastName: selected.lastName,
        status: selected.status,
        commissionRate:
          canEditCommission && selected.commissionRate !== null
            ? String(selected.commissionRate)
            : "",
        rating: canEditCommission && selected.rating !== null ? String(selected.rating) : "",
      }),
  );
  const totalRevenue = items.reduce((total, barber) => total + barber.revenue, 0);
  const totalCommission = items
    .reduce((total, barber) => total + BigInt(barberCommission(barber)), BigInt(0))
    .toString();
  function openCreate() {
    setForm({ ...emptyForm, branchId });
    setFormError("");
    setCreateOpen(true);
  }
  function openDetails(barber: ApiBarber) {
    setSelected(barber);
    setEditing(false);
  }
  function openEdit(barber: ApiBarber) {
    setSelected(barber);
    setForm({
      branchId: barber.branchId,
      firstName: barber.firstName,
      lastName: barber.lastName,
      status: barber.status,
      commissionRate:
        canEditCommission && barber.commissionRate !== null ? String(barber.commissionRate) : "",
      rating: canEditCommission && barber.rating !== null ? String(barber.rating) : "",
    });
    setFormError("");
    setEditing(true);
  }
  function closeDrawer() {
    setSelected(null);
    setEditing(false);
    setFormError("");
  }
  async function saveBarber(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const firstName = form.firstName.trim();
      const lastName = form.lastName.trim();
      if (!firstName || !lastName) throw new Error("First and last name are required.");
      const commissionRate = form.commissionRate === "" ? null : Number(form.commissionRate);
      if (
        canEditCommission &&
        commissionRate !== null &&
        (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100)
      )
        throw new Error("Commission rate must be between 0 and 100.");
      const rating = form.rating === "" ? null : Number(form.rating);
      if (
        canEditCommission &&
        rating !== null &&
        (!Number.isFinite(rating) || rating < 0 || rating > 5)
      )
        throw new Error("Rating must be between 0 and 5.");
      const payload = {
        branchId: form.branchId,
        firstName,
        lastName,
        status: form.status,
        ...(canEditCommission
          ? { commissionRate: editing && selected ? selected.commissionRate : null, rating }
          : {}),
      };
      const response = await apiRequest(
        editing && selected ? `/api/barbers/${selected.id}` : "/api/barbers",
        { method: editing && selected ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      const body = await readApiBody<{
        success: boolean;
        barber?: ApiBarber;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.barber)
        throw new Error(responseMessage(body, "Unable to save barber"));
      await loadBarbers();
      if (editing) {
        setSelected(body.barber);
        setEditing(false);
      } else setCreateOpen(false);
      onToast(`${displayName(body.barber)} ${editing ? "updated" : "added"}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save barber");
    } finally {
      setSubmitting(false);
    }
  }
  async function deleteBarber(barber: ApiBarber) {
    setDeletingId(barber.id);
    try {
      const response = await apiRequest(`/api/barbers/${barber.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to delete barber");
      setItems((current) => current.filter((item) => item.id !== barber.id));
      if (selected?.id === barber.id) closeDrawer();
      onToast(`${displayName(barber)} removed from the roster`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to delete barber");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }
  function barberForm() {
    return (
      <form className="operational-drawer-form" onSubmit={saveBarber}>
        <SelectField
          label="Branch"
          required
          value={form.branchId}
          onChange={(event) =>
            setForm((current) => ({ ...current, branchId: Number(event.target.value) }))
          }
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </SelectField>
        <p>
          Moving a barber preserves their schedule. Resolve active bookings and queue work, and
          ensure shifts fit the destination hours first.
        </p>
        <div className="form-grid form-grid--two operational-form-grid">
          <TextField
            label="First name"
            required
            value={form.firstName}
            onChange={(event) =>
              setForm((current) => ({ ...current, firstName: event.target.value }))
            }
          />
          <TextField
            label="Last name"
            required
            value={form.lastName}
            onChange={(event) =>
              setForm((current) => ({ ...current, lastName: event.target.value }))
            }
          />
        </div>
        <SelectField
          label="Status"
          value={form.status}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              status: event.target.value as BarberForm["status"],
            }))
          }
        >
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="unavailable">Unavailable</option>
        </SelectField>
        {canEditCommission && (
          <div className="form-grid form-grid--two operational-form-grid">
            <p>Manage individual commission rates and history in Payroll settings.</p>
            <TextField
              label="Rating"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={form.rating}
              onChange={(event) =>
                setForm((current) => ({ ...current, rating: event.target.value }))
              }
            />
          </div>
        )}
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={submitting}
            onClick={() => (editing ? setEditing(false) : setCreateOpen(false))}
          >
            Cancel
          </Button>
          <Button type="submit" icon="check" disabled={submitting || !form.branchId}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Add barber"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="operational-workspace">
      <PageHeader
        title="Barber management"
        action={
          <>
            <BranchSwitcher
              branches={branches}
              value={branchId}
              disabled={submitting}
              onChange={(id) => {
                closeDrawer();
                setCreateOpen(false);
                setItems([]);
                setBranchId(id);
              }}
            />
            <ViewToggle view={view} onChange={setView} label="Choose barber view" />
            <Link className="button button--secondary button--md" href="/admin/payroll">
              <span>Payroll &amp; rates</span>
            </Link>
            <Button icon="plus" onClick={openCreate}>
              Add barber
            </Button>
          </>
        }
      />
      {items.some((barber) => barber.scheduleDayCount < 7) && (
        <div className="alert-banner" role="status">
          <span className="alert-banner__icon">
            <Icon name="calendar" size={15} />
          </span>
          <span>
            <strong>
              {items
                .filter((barber) => barber.scheduleDayCount < 7)
                .map(displayName)
                .join(", ")}{" "}
              {items.filter((barber) => barber.scheduleDayCount < 7).length === 1 ? "has" : "have"}{" "}
              days without a weekly schedule
            </strong>
            <small>
              Customers cannot book those days until each day is saved under Weekly schedules.
            </small>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              document
                .getElementById("barber-schedules")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Set up schedules
          </Button>
        </div>
      )}
      {branchError && <p role="alert">{branchError}</p>}
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Total barbers"
          value={String(items.length)}
          icon="scissors"
          accent="blue"
        />
        <MetricCard
          label="Active roster"
          value={String(items.filter((item) => item.status !== "unavailable").length)}
          icon="check"
          accent="green"
        />
        <MetricCard
          label="Roster revenue"
          value={formatCurrency(totalRevenue)}
          icon="wallet"
          accent="amber"
        />
        <MetricCard
          label="Accrued commission"
          value={payrollMoney(totalCommission)}
          icon="spark"
          accent="violet"
        />
      </div>
      <Panel className="operational-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>Barber roster</h2>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search barbers"
          filters={
            <>
              <SelectField
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | ApiBarber["status"])
                }
                aria-label="Filter barbers by status"
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="unavailable">Unavailable</option>
              </SelectField>
              <SelectField
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort barbers"
              >
                <option value="name">Name A–Z</option>
                <option value="services">Most services</option>
                <option value="revenue">Highest revenue</option>
              </SelectField>
            </>
          }
          resultCount={visible.length}
        />
        {loading ? (
          <SkeletonCards label="Loading barbers" />
        ) : loadError ? (
          <div className="operational-loading" role="alert">
            {loadError}
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon="scissors"
            title="No barbers found"
            description="Add a barber or change the current filters."
            action={
              <Button size="sm" icon="plus" onClick={openCreate}>
                Add barber
              </Button>
            }
          />
        ) : view === "cards" ? (
          <div className="operational-card-grid">
            {visible.map((barber) => (
              <RecordCard
                key={barber.id}
                onOpen={() => openDetails(barber)}
                ariaLabel={`Open ${displayName(barber)}`}
              >
                <div className="operational-card__header">
                  <div className="operational-card__identity">
                    <Avatar initials={createInitials(displayName(barber))} tone="slate" size="md" />
                    <div>
                      <strong>{displayName(barber)}</strong>
                      <small>Barber #{barber.id}</small>
                    </div>
                  </div>
                  <Badge tone={statusTone(barber.status)}>{statusLabel(barber.status)}</Badge>
                </div>
                <div className="operational-card__facts">
                  <div>
                    <span>Services done</span>
                    <strong>{barber.servicesDone}</strong>
                  </div>
                  <div>
                    <span>Rating</span>
                    <strong className="is-warning">
                      {barber.rating === null ? "—" : `★ ${barber.rating.toFixed(1)}`}
                    </strong>
                  </div>
                  <div>
                    <span>Revenue</span>
                    <strong className="is-positive">{formatCurrency(barber.revenue)}</strong>
                  </div>
                  <div>
                    <span>Commission</span>
                    <strong>
                      {barber.commissionRate === null ? "—" : `${barber.commissionRate}%`}
                    </strong>
                  </div>
                </div>
              </RecordCard>
            ))}
          </div>
        ) : (
          <ResponsiveTable
            headers={["Barber", "Status", "Services", "Revenue", "Commission", "Rating", "Actions"]}
          >
            {visible.map((barber) => (
              <tr
                key={barber.id}
                tabIndex={0}
                onClick={() => openDetails(barber)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetails(barber);
                  }
                }}
              >
                <td>
                  <span className="table-person">
                    <Avatar initials={createInitials(displayName(barber))} tone="slate" size="sm" />
                    <span>
                      <strong>{displayName(barber)}</strong>
                      <small>Barber #{barber.id}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <Badge tone={statusTone(barber.status)}>{statusLabel(barber.status)}</Badge>
                </td>
                <td>{barber.servicesDone}</td>
                <td className="text-green">{formatCurrency(barber.revenue)}</td>
                <td>{barber.commissionRate === null ? "—" : `${barber.commissionRate}%`}</td>
                <td>{barber.rating === null ? "—" : `★ ${barber.rating.toFixed(1)}`}</td>
                <td>
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="row-action row-action--icon"
                      type="button"
                      onClick={() => openEdit(barber)}
                      aria-label={`Edit ${displayName(barber)}`}
                      title={`Edit ${displayName(barber)}`}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    {canDelete && (
                      <button
                        className="row-action row-action--icon row-action--danger"
                        type="button"
                        onClick={() => setPendingDelete(barber)}
                        aria-label={`Delete ${displayName(barber)}`}
                        title={`Delete ${displayName(barber)}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </ResponsiveTable>
        )}
      </Panel>
      <div id="barber-schedules">
        <ScheduleManagement
          key={branchId}
          branchId={branchId}
          barbers={items.filter((barber) => barber.branchId === branchId)}
          onToast={onToast}
        />
      </div>
      <Modal
        open={createOpen}
        title="Add barber"
        onClose={() => !submitting && setCreateOpen(false)}
      >
        {barberForm()}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected ? displayName(selected) : "Barber details"}
        subtitle={selected ? `Barber #${selected.id}` : undefined}
        eyebrow="Barber profile"
        onClose={closeDrawer}
        dirty={dirty}
        onDiscard={() => setEditing(false)}
      >
        {selected &&
          (editing ? (
            <DrawerSection eyebrow="Edit profile" title="Update barber">
              {barberForm()}
            </DrawerSection>
          ) : (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials={createInitials(displayName(selected))} tone="slate" size="lg" />
                  <div>
                    <strong>{statusLabel(selected.status)}</strong>
                    <span>{selected.servicesDone} services completed</span>
                  </div>
                  <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Performance" title="Roster snapshot">
                <div className="operational-drawer__facts">
                  <div>
                    <span>Revenue</span>
                    <strong>{formatCurrency(selected.revenue)}</strong>
                  </div>
                  <div>
                    <span>Commission</span>
                    <strong>{payrollMoney(barberCommission(selected))}</strong>
                  </div>
                  <div>
                    <span>Commission rate</span>
                    <strong>
                      {selected.commissionRate === null ? "Not set" : `${selected.commissionRate}%`}
                    </strong>
                  </div>
                  <div>
                    <span>Rating</span>
                    <strong>
                      {selected.rating === null ? "Not rated" : `★ ${selected.rating.toFixed(1)}`}
                    </strong>
                  </div>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Actions" title="Manage roster">
                <div className="operational-drawer__actions">
                  <Button variant="secondary" icon="edit" onClick={() => openEdit(selected)}>
                    Edit profile
                  </Button>
                  {canDelete && (
                    <Button
                      variant="danger"
                      icon="trash"
                      onClick={() => setPendingDelete(selected)}
                    >
                      Remove barber
                    </Button>
                  )}
                </div>
              </DrawerSection>
            </>
          ))}
      </DetailDrawer>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this barber profile?"
        description={
          pendingDelete
            ? `${displayName(pendingDelete)} will be removed only if no linked records, including attendance history, reference the profile.`
            : undefined
        }
        confirmLabel="Delete barber"
        danger
        busy={deletingId !== null}
        onClose={() => deletingId === null && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteBarber(pendingDelete)}
      />
    </div>
  );
}
