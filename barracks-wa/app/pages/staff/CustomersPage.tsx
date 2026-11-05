"use client";
import { SkeletonCards } from "@/app/components/ui/Skeletons";

import { emailFieldError, phoneFieldError } from "@/app/utils/contact-validation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ApiBarberAvailability, ApiCustomer } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import { createInitials } from "@/app/utils/format";
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  MetricCard,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import {
  DetailDrawer,
  DrawerSection,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";

type CustomerForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loyaltyPoints: string;
  password: string;
  preferredBarberId: string;
};
const emptyForm: CustomerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  loyaltyPoints: "0",
  password: "",
  preferredBarberId: "",
};
function nameOf(customer: ApiCustomer) {
  return `${customer.firstName} ${customer.lastName}`.trim();
}
function phoneForForm(customer: ApiCustomer) {
  const digits = customer.phone.replace(/[\s()-]/g, "");
  return customer.userId === null && /^\+639\d{9}$/.test(digits)
    ? `0${digits.slice(3)}`
    : customer.phone;
}
function responseMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
) {
  return body?.errors
    ? Object.values(body.errors).flat().join(" ") || body?.message || fallback
    : body?.message || fallback;
}
const PAGE_SIZE = 12;
function formatMemberSince(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function CustomersPage({
  onToast,
  canDelete,
  canManageLoyalty,
}: {
  onToast: (message: string) => void;
  canDelete: boolean;
  canManageLoyalty: boolean;
}) {
  const [items, setItems] = useState<ApiCustomer[]>([]);
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [barberLoading, setBarberLoading] = useState(true);
  const [barberError, setBarberError] = useState("");
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [selected, setSelected] = useState<ApiCustomer | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiCustomer | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomers() {
      try {
        const response = await apiRequest("/api/customers", {
          cache: "no-store",
          reuseForMs: 15_000,
        });
        const body = await readApiBody<{
          success: boolean;
          customers?: ApiCustomer[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !body.customers)
          throw new Error(body?.message ?? "Unable to load customers");
        if (!cancelled) {
          setItems(body.customers);
          setLoadError("");
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to load customers";
          setLoadError(message);
          onToast(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    async function loadBarbers() {
      try {
        const response = await apiRequest("/api/barbers?view=options", { cache: "no-store" });
        const body = await readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[] }>(
          response,
        );
        if (!response.ok || !body?.success || !body.barbers)
          throw new Error("Unable to load preferred barbers");
        if (!cancelled) setBarbers(body.barbers);
      } catch {
        if (!cancelled) setBarberError("Preferred barbers unavailable. Reopen this page to retry.");
      } finally {
        if (!cancelled) setBarberLoading(false);
      }
    }
    void loadCustomers();
    void loadBarbers();
    return () => {
      cancelled = true;
    };
  }, [onToast]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...items]
      .filter((customer) =>
        `${nameOf(customer)} ${customer.email} ${customer.phone}`.toLowerCase().includes(query),
      )
      .sort((a, b) =>
        sort === "name"
          ? nameOf(a).localeCompare(nameOf(b))
          : sort === "points"
            ? b.loyaltyPoints - a.loyaltyPoints
            : b.createdAt.localeCompare(a.createdAt),
      );
  }, [items, search, sort]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const dirty = Boolean(
    selected &&
    editing &&
    JSON.stringify({ ...form, password: "" }) !==
      JSON.stringify({
        firstName: selected.firstName,
        lastName: selected.lastName,
        email: selected.email,
        phone: phoneForForm(selected),
        loyaltyPoints: String(selected.loyaltyPoints),
        password: "",
        preferredBarberId: selected.preferredBarberId ? String(selected.preferredBarberId) : "",
      }),
  );

  function openCreate() {
    setForm(emptyForm);
    setFormError("");
    setCreateOpen(true);
  }
  function openDetails(customer: ApiCustomer) {
    setSelected(customer);
    setEditing(false);
    setFormError("");
  }
  function openEdit(customer: ApiCustomer) {
    setSelected(customer);
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: phoneForForm(customer),
      loyaltyPoints: String(customer.loyaltyPoints),
      password: "",
      preferredBarberId: customer.preferredBarberId ? String(customer.preferredBarberId) : "",
    });
    setFormError("");
    setEditing(true);
  }
  function closeDrawer() {
    setSelected(null);
    setEditing(false);
    setFormError("");
  }
  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const loyaltyPoints = Number(form.loyaltyPoints);
      if (
        canManageLoyalty &&
        (!Number.isSafeInteger(loyaltyPoints) || loyaltyPoints < 0 || loyaltyPoints > 2147483647)
      )
        throw new Error("Loyalty points must be a non-negative whole number.");
      const base = {
        firstName: form.firstName,
        lastName: form.lastName,
        ...(editing && selected?.userId === null ? {} : { email: form.email }),
        phone: form.phone,
        preferredBarberId: form.preferredBarberId ? Number(form.preferredBarberId) : null,
      };
      const payload =
        editing && selected
          ? canManageLoyalty
            ? { ...base, loyaltyPoints }
            : base
          : { ...base, password: form.password };
      const response = await apiRequest(
        editing && selected ? `/api/customers/${selected.id}` : "/api/customers",
        { method: editing && selected ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      const body = await readApiBody<{
        success: boolean;
        customer?: ApiCustomer;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.customer)
        throw new Error(responseMessage(body, "Unable to save customer"));
      setItems((current) =>
        editing
          ? current.map((item) => (item.id === body.customer!.id ? body.customer! : item))
          : [body.customer!, ...current],
      );
      if (editing) {
        setSelected(body.customer);
        setEditing(false);
      } else setCreateOpen(false);
      onToast(`${nameOf(body.customer)} ${editing ? "updated" : "created"}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save customer");
    } finally {
      setSubmitting(false);
    }
  }
  async function deleteCustomer(customer: ApiCustomer) {
    setDeletingId(customer.id);
    try {
      const response = await apiRequest(`/api/customers/${customer.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to delete customer");
      setItems((current) => current.filter((item) => item.id !== customer.id));
      if (selected?.id === customer.id) closeDrawer();
      onToast(`${nameOf(customer)} deactivated; the customer record was retained`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to delete customer");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }
  function customerForm() {
    return (
      <form className="operational-drawer-form" onSubmit={saveCustomer}>
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
        {(!editing || selected?.userId !== null) && (
          <TextField
            label="Email address"
            type="email"
            required
            value={form.email}
            error={emailFieldError(form.email)}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            icon="mail"
          />
        )}
        <TextField
          label="Phone number"
          type="tel"
          inputMode="numeric"
          maxLength={11}
          value={form.phone}
          error={phoneFieldError(form.phone)}
          onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          icon="phone"
        />
        {canManageLoyalty && (
          <TextField
            label="Loyalty points"
            type="number"
            min="0"
            step="1"
            value={form.loyaltyPoints}
            onChange={(event) =>
              setForm((current) => ({ ...current, loyaltyPoints: event.target.value }))
            }
          />
        )}
        {!editing && (
          <TextField
            label="Temporary password"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            icon="lock"
          />
        )}
        <SelectField
          label="Preferred barber"
          disabled={barberLoading || Boolean(barberError)}
          value={form.preferredBarberId}
          onChange={(event) =>
            setForm((current) => ({ ...current, preferredBarberId: event.target.value }))
          }
        >
          <option value="">{barberLoading ? "Loading barbers…" : "Not set"}</option>
          {barbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.firstName} {barber.lastName}
            </option>
          ))}
        </SelectField>
        {barberError && (
          <p className="form-error" role="alert">
            {barberError}
          </p>
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
          <Button type="submit" icon="check" disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Create customer"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="operational-workspace">
      <PageHeader
        title="Customer management"
        action={
          <>
            <ViewToggle view={view} onChange={setView} label="Choose customer view" />
            <Button icon="userPlus" onClick={openCreate}>
              Add customer
            </Button>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--three">
        <MetricCard
          label="Customer records"
          value={String(items.length)}
          icon="users"
          accent="blue"
        />
        <MetricCard
          label="Preferred barber set"
          value={String(items.filter((item) => item.preferredBarberId !== null).length)}
          icon="scissors"
          accent="green"
        />
        <MetricCard
          label="Loyalty points"
          value={String(items.reduce((total, item) => total + item.loyaltyPoints, 0))}
          icon="spark"
          accent="amber"
        />
      </div>
      <Panel className="operational-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>Customer directory</h2>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search customers"
          filters={
            <SelectField
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
              aria-label="Sort customers"
            >
              <option value="recent">Recently joined</option>
              <option value="name">Name A–Z</option>
              <option value="points">Most loyalty points</option>
            </SelectField>
          }
        />
        {loading ? (
          <SkeletonCards label="Loading customers" />
        ) : loadError ? (
          <div className="operational-loading" role="alert">
            {loadError}
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon="users"
            title="No customers found"
            description="Add a customer or try a different search."
            action={
              <Button size="sm" icon="userPlus" onClick={openCreate}>
                Add customer
              </Button>
            }
          />
        ) : view === "cards" ? (
          <div className="operational-card-grid">
            {pageItems.map((customer) => (
              <RecordCard
                key={customer.id}
                onOpen={() => openDetails(customer)}
                ariaLabel={`Open ${nameOf(customer)}`}
              >
                <div className="operational-card__header">
                  <div className="operational-card__identity">
                    <Avatar initials={createInitials(nameOf(customer))} tone="slate" size="md" />
                    <div>
                      <strong>{nameOf(customer)}</strong>
                      <small>Customer #{customer.id}</small>
                    </div>
                  </div>
                  <Icon name="chevronRight" size={17} />
                </div>
                <p className="operational-card__note">
                  {customer.userId === null ? "Walk-in · no account" : customer.email}
                  <br />
                  {customer.phone || "No phone on file"}
                </p>
                <div className="operational-card__facts">
                  <div>
                    <span>Loyalty</span>
                    <strong className="is-warning">{customer.loyaltyPoints} pts</strong>
                  </div>
                  <div>
                    <span>Preferred barber</span>
                    <strong>{customer.preferredBarberName || "Not set"}</strong>
                  </div>
                </div>
              </RecordCard>
            ))}
          </div>
        ) : (
          <ResponsiveTable
            className="customers-table"
            headers={["Customer", "Contact", "Preferred barber", "Loyalty", "Joined", ""]}
          >
            {pageItems.map((customer) => (
              <tr
                key={customer.id}
                tabIndex={0}
                onClick={() => openDetails(customer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetails(customer);
                  }
                }}
              >
                <td>
                  <span className="table-person">
                    <Avatar initials={createInitials(nameOf(customer))} tone="slate" size="sm" />
                    <span>
                      <strong>{nameOf(customer)}</strong>
                      <small>Customer #{customer.id}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <span className="table-stack">
                    <span title={customer.userId === null ? undefined : customer.email}>
                      {customer.userId === null ? "Walk-in · no account" : customer.email}
                    </span>
                    <small>{customer.phone || "No phone"}</small>
                  </span>
                </td>
                <td>{customer.preferredBarberName || "Not set"}</td>
                <td className="text-amber">{customer.loyaltyPoints} pts</td>
                <td>{formatMemberSince(customer.createdAt)}</td>
                <td>
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="row-action row-action--icon"
                      type="button"
                      onClick={() => openEdit(customer)}
                      aria-label={`Edit ${nameOf(customer)}`}
                      title={`Edit ${nameOf(customer)}`}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    {canDelete && customer.userId !== null && (
                      <button
                        className="row-action row-action--icon row-action--danger"
                        type="button"
                        onClick={() => setPendingDelete(customer)}
                        aria-label={`Deactivate ${nameOf(customer)}`}
                        title={`Deactivate ${nameOf(customer)}`}
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
        {!loading && !loadError && visible.length > 0 && (
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            summary={`${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visible.length)} of ${visible.length} customers`}
          />
        )}
      </Panel>
      <Modal
        open={createOpen}
        title="Add customer"
        onClose={() => !submitting && setCreateOpen(false)}
      >
        {customerForm()}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected ? nameOf(selected) : "Customer profile"}
        subtitle={selected ? `Customer #${selected.id}` : undefined}
        eyebrow="Customer profile"
        onClose={closeDrawer}
        dirty={dirty}
        onDiscard={() => setEditing(false)}
      >
        {selected &&
          (editing ? (
            <DrawerSection eyebrow="Edit profile" title="Update customer">
              {customerForm()}
            </DrawerSection>
          ) : (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials={createInitials(nameOf(selected))} tone="slate" size="lg" />
                  <div>
                    <strong>
                      {selected.userId === null
                        ? "Walk-in record · no login account"
                        : selected.email}
                    </strong>
                    <span>{selected.phone || "No phone on file"}</span>
                  </div>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Customer facts" title="Relationship snapshot">
                <div className="operational-drawer__facts">
                  <div>
                    <span>Loyalty points</span>
                    <strong>{selected.loyaltyPoints}</strong>
                  </div>
                  <div>
                    <span>Preferred barber</span>
                    <strong>{selected.preferredBarberName || "Not set"}</strong>
                  </div>
                  <div>
                    <span>Member since</span>
                    <strong>{formatMemberSince(selected.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Record ID</span>
                    <strong>#{selected.id}</strong>
                  </div>
                </div>
              </DrawerSection>
              {selected.userId === null ? (
                <DrawerSection eyebrow="Walk-in record" title="No login account">
                  <p>
                    This record can join the queue now. Account linking can be handled separately.
                  </p>
                </DrawerSection>
              ) : null}
              <DrawerSection eyebrow="Actions" title="Manage customer">
                <div className="operational-drawer__actions">
                  <Button variant="secondary" icon="edit" onClick={() => openEdit(selected)}>
                    Edit profile
                  </Button>
                  {canDelete && selected.userId !== null && (
                    <Button
                      variant="danger"
                      icon="trash"
                      onClick={() => setPendingDelete(selected)}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </DrawerSection>
            </>
          ))}
      </DetailDrawer>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Deactivate this customer?"
        description={
          pendingDelete
            ? `${nameOf(pendingDelete)} will lose access, while the customer record is retained.`
            : undefined
        }
        confirmLabel="Deactivate customer"
        danger
        busy={deletingId !== null}
        onClose={() => deletingId === null && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteCustomer(pendingDelete)}
      />
    </div>
  );
}
