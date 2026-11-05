"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { useEffect, useState, type FormEvent } from "react";
import type { Service } from "@/app/types/domain";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { createSlug, formatCurrency } from "@/app/utils/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  Modal,
  PageHeader,
  Panel,
  SectionHeading,
  SelectField,
  TextField,
} from "@/app/components/ui";

type Draft = {
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
  active: boolean;
};
const blank: Draft = { name: "", description: "", durationMinutes: "", price: "", active: true };

export function ServicesManagement({ onToast }: { onToast: (message: string) => void }) {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("All");
  const [pendingAction, setPendingAction] = useState<{
    service: Service;
    kind: "delete" | "archive";
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await apiRequest("/api/services", { cache: "no-store" });
        const body = await readApiBody<{
          success: boolean;
          services?: Service[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Unable to load services");
        setItems(body.services ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load services");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function openEdit(service: Service) {
    setEditing(service);
    setDraft({
      name: service.name,
      description: service.description,
      durationMinutes: String(service.durationMinutes ?? ""),
      price: String(service.price),
      active: service.active,
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const price = Number(draft.price);
    const durationMinutes = Number(draft.durationMinutes);
    if (
      !draft.name.trim() ||
      draft.price.trim() === "" ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0
    ) {
      onToast("Enter a name, nonnegative price, and positive whole minute duration");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        price,
        durationMinutes,
        active: draft.active,
      };
      const response = await apiRequest(editing ? `/api/services/${editing.id}` : "/api/services", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(editing ? payload : { ...payload, id: createSlug(payload.name) }),
      });
      const body = await readApiBody<{ success: boolean; service?: Service; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.service)
        throw new Error(body?.message ?? "Unable to save service");
      const saved = body.service;
      setItems((current) =>
        editing
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      );
      setAdding(false);
      setEditing(null);
      setDraft(blank);
      onToast(`${saved.name} saved`);
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to save service");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(service: Service) {
    setBusyId(service.id);
    try {
      const response = await apiRequest(`/api/services/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !service.active }),
      });
      const body = await readApiBody<{ success: boolean; service?: Service; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.service)
        throw new Error(body?.message ?? "Unable to update service");
      setItems((current) => current.map((item) => (item.id === service.id ? body.service! : item)));
      setPendingAction(null);
      onToast(`${service.name} ${service.active ? "archived" : "restored"}`);
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to update service");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmAction() {
    if (!pendingAction || busyId !== null) return;
    const { service, kind } = pendingAction;
    if (kind === "archive") {
      await toggle(service);
      return;
    }
    setBusyId(service.id);
    try {
      const response = await apiRequest(`/api/services/${service.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; code?: string; message?: string }>(
        response,
      );
      if (response.status === 409 && body?.code === "SERVICE_HAS_HISTORY") {
        setItems((current) =>
          current.map((item) => (item.id === service.id ? { ...item, hasHistory: true } : item)),
        );
        setPendingAction(
          service.active ? { service: { ...service, hasHistory: true }, kind: "archive" } : null,
        );
        onToast(body.message ?? "This service now has history and can only be archived.");
        return;
      }
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to delete service");
      setItems((current) => current.filter((item) => item.id !== service.id));
      setPendingAction(null);
      onToast(`${service.name} deleted`);
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to delete service");
    } finally {
      setBusyId(null);
    }
  }

  const visible = items.filter(
    (service) => filter === "All" || (filter === "Active" ? service.active : !service.active),
  );
  return (
    <>
      <PageHeader
        title="Services"
        action={
          <Button
            icon="plus"
            onClick={() => {
              setDraft(blank);
              setAdding(true);
            }}
          >
            Add service
          </Button>
        }
      />
      <div className="metrics-grid metrics-grid--three">
        <MetricCard
          label="Total services"
          value={String(items.length)}
          icon="briefcase"
          accent="blue"
        />
        <MetricCard
          label="Average price"
          value={formatCurrency(
            items.length ? items.reduce((sum, item) => sum + item.price, 0) / items.length : 0,
          )}
          icon="wallet"
          accent="green"
        />
        <MetricCard
          label="Active services"
          value={String(items.filter((item) => item.active).length)}
          icon="star"
          accent="amber"
        />
      </div>
      <Panel className="services-panel">
        <SectionHeading
          title="All services"
          action={
            <Button variant="ghost" size="sm" icon="filter" onClick={() => setFilterOpen(true)}>
              Filters
            </Button>
          }
        />
        <div className="services-table">
          <div className="services-table__head">
            <span>Service</span>
            <span>Description</span>
            <span>Duration</span>
            <span>Price</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {loading ? (
            <SkeletonRows count={6} label="Loading services" />
          ) : error ? (
            <div role="alert">{error}</div>
          ) : visible.length ? (
            visible.map((service) => (
              <div className="services-table__row" key={service.id}>
                <span>
                  <strong>{service.name}</strong>
                </span>
                <span>{service.description}</span>
                <span>
                  {service.durationMinutes === null ? "Unknown" : `${service.durationMinutes} mins`}
                </span>
                <strong>{formatCurrency(service.price)}</strong>
                <span>
                  <Badge tone={service.active ? "success" : "warning"}>
                    {service.active ? "Active" : "Archived"}
                  </Badge>
                </span>
                <span className="row-actions">
                  <button
                    className="row-action"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => openEdit(service)}
                  >
                    Edit
                  </button>
                  <button
                    className="row-action"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() =>
                      service.active
                        ? setPendingAction({ service, kind: "archive" })
                        : void toggle(service)
                    }
                  >
                    {service.active ? "Archive" : "Restore"}
                  </button>
                  {service.hasHistory === false && (
                    <button
                      className="row-action row-action--danger"
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => setPendingAction({ service, kind: "delete" })}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </div>
            ))
          ) : (
            <EmptyState
              title="No services found"
              description="Add a service or change the filter."
            />
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.kind === "delete" ? "Delete this service?" : "Archive this service?"}
        description={
          pendingAction
            ? pendingAction.kind === "delete"
              ? `${pendingAction.service.name} will be permanently deleted if it has no bookings, queue visits, or transactions.`
              : `${pendingAction.service.name} will be unavailable for new bookings and queue visits. Existing records will be retained, and you can restore it later.`
            : undefined
        }
        confirmLabel={pendingAction?.kind === "delete" ? "Delete service" : "Archive service"}
        danger
        busy={busyId !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={() => void confirmAction()}
      />
      <Modal
        open={adding || Boolean(editing)}
        title={editing ? "Edit service" : "Add service"}
        onClose={() => {
          if (!saving) {
            setAdding(false);
            setEditing(null);
          }
        }}
      >
        <form className="modal-form" onSubmit={save}>
          <TextField
            label="Service name"
            required
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <TextField
            label="Description"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <div className="form-grid form-grid--two">
            <TextField
              label="Duration (minutes)"
              type="number"
              required
              min="1"
              step="1"
              value={draft.durationMinutes}
              onChange={(event) => setDraft({ ...draft, durationMinutes: event.target.value })}
            />
            <TextField
              label="Price"
              type="number"
              required
              min="0"
              step="0.01"
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
          </div>
          {!editing && (
            <SelectField
              label="Status"
              value={draft.active ? "Active" : "Inactive"}
              onChange={(event) => setDraft({ ...draft, active: event.target.value === "Active" })}
            >
              <option>Active</option>
              <option value="Inactive">Archived</option>
            </SelectField>
          )}
          {editing && (
            <p>
              Status: {editing.active ? "Active" : "Archived"}. Use Archive or Restore in the
              service list to change availability.
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={saving}
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save service"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={filterOpen} title="Filter services" onClose={() => setFilterOpen(false)}>
        <div className="modal-form">
          <SelectField
            label="Show"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option>All</option>
            <option>Active</option>
            <option value="Inactive">Archived</option>
          </SelectField>
          <div className="modal-actions">
            <Button type="button" onClick={() => setFilterOpen(false)}>
              Apply filter
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
