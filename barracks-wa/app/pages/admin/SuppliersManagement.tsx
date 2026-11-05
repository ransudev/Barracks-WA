"use client";
import { SkeletonCards, SkeletonRows } from "@/app/components/ui/Skeletons";

import { SupplierItemsModal } from "@/app/components/inventory/SupplierItemsModal";
import {
  EMAIL_MESSAGE,
  PHONE_MESSAGE,
  isValidEmail,
  isValidPhone,
} from "@/app/utils/contact-validation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ApiSupplier } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import {
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
import {
  DetailDrawer,
  DrawerSection,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";

type SupplierForm = {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: "active" | "inactive";
};
type AccountForm = { firstName: string; lastName: string; email: string; password: string };
type SupplierProfile = {
  supplier: ApiSupplier;
  suppliedItems: Array<{
    id: number;
    name: string;
    category: string;
    quantity: number;
    minimum_stock: number;
    maximum_stock: number | null;
    unit: string;
    sku: string | null;
    unit_cost: number | string;
    status: string;
    branch: string;
  }>;
  recentDeliveries: Array<{
    id: number;
    status: string;
    branch: string;
    reference: string | null;
    received_at: string | null;
    created_at: string;
  }>;
  restockHistory: Array<{
    id: number;
    status: string;
    branch: string;
    reference: string | null;
    notes: string;
    created_at: string;
    updated_at: string;
  }>;
};
const emptySupplier: SupplierForm = {
  companyName: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  status: "active",
};
const emptyAccount: AccountForm = { firstName: "", lastName: "", email: "", password: "" };
function responseMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
) {
  return body?.errors
    ? Object.values(body.errors).flat().join(" ") || body?.message || fallback
    : body?.message || fallback;
}

export function SuppliersManagement({
  onToast,
  canManageLogins = false,
  canDeactivate = false,
}: {
  onToast: (message: string) => void;
  canManageLogins?: boolean;
  canDeactivate?: boolean;
}) {
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<ApiSupplier | null>(null);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SupplierForm>(emptySupplier);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [accountSupplier, setAccountSupplier] = useState<ApiSupplier | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccount);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiSupplier | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest("/api/suppliers", { cache: "no-store" });
      const body = await readApiBody<{
        success: boolean;
        suppliers?: ApiSupplier[];
        message?: string;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to load suppliers");
      setSuppliers(body.suppliers ?? []);
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load suppliers";
      setLoadError(message);
      onToast(message);
    } finally {
      setLoading(false);
    }
  }, [onToast]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  const [itemsSupplier, setItemsSupplier] = useState<ApiSupplier | null>(null);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers.filter(
      (supplier) =>
        (!query ||
          `${supplier.companyName} ${supplier.contactPerson} ${supplier.email} ${supplier.phone}`
            .toLowerCase()
            .includes(query)) &&
        (statusFilter === "all" || supplier.status === statusFilter),
    );
  }, [search, statusFilter, suppliers]);
  const dirty = Boolean(
    selected &&
    editing &&
    JSON.stringify(form) !==
      JSON.stringify({
        companyName: selected.companyName,
        contactPerson: selected.contactPerson,
        phone: selected.phone,
        email: selected.email,
        address: selected.address,
        notes: selected.notes,
        status: selected.status,
      }),
  );
  async function openDetails(supplier: ApiSupplier) {
    setSelected(supplier);
    setEditing(false);
    setProfile(null);
    setProfileLoading(true);
    try {
      const response = await apiRequest(`/api/suppliers/${supplier.id}`, { cache: "no-store" });
      const body = await readApiBody<{
        success: boolean;
        profile?: SupplierProfile;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.profile)
        throw new Error(body?.message ?? "Unable to load supplier profile");
      setProfile(body.profile);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to load supplier profile");
    } finally {
      setProfileLoading(false);
    }
  }
  function openCreate() {
    setForm(emptySupplier);
    setFormError("");
    setCreateOpen(true);
  }
  function openEdit(supplier: ApiSupplier) {
    setSelected(supplier);
    setForm({
      companyName: supplier.companyName,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      notes: supplier.notes,
      status: supplier.status,
    });
    setFormError("");
    setEditing(true);
  }
  function closeDrawer() {
    setSelected(null);
    setProfile(null);
    setEditing(false);
    setFormError("");
  }
  const phoneError = form.phone.trim() && !isValidPhone(form.phone) ? PHONE_MESSAGE : undefined;
  const emailError = form.email.trim() && !isValidEmail(form.email) ? EMAIL_MESSAGE : undefined;
  async function save(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (phoneError || emailError) return;
    if (!form.phone.trim() && !form.email.trim()) {
      setFormError("Provide a contact number or email address");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiRequest(
        editing && selected ? `/api/suppliers/${selected.id}` : "/api/suppliers",
        { method: editing && selected ? "PUT" : "POST", body: JSON.stringify(form) },
      );
      const body = await readApiBody<{
        success: boolean;
        supplier?: ApiSupplier;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(responseMessage(body, "Unable to save supplier"));
      setCreateOpen(false);
      setEditing(false);
      onToast(editing ? "Supplier updated" : "Supplier created. Now choose the items they supply.");
      await load();
      if (!editing && body.supplier) setItemsSupplier(body.supplier);
      if (editing && selected) {
        const refreshed = body.supplier ?? suppliers.find((item) => item.id === selected.id);
        if (refreshed) {
          setSelected(refreshed);
          void openDetails(refreshed);
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save supplier");
    } finally {
      setSubmitting(false);
    }
  }
  async function deactivate(supplier: ApiSupplier) {
    if (!canDeactivate) return;
    setDeleteBusy(true);
    try {
      const response = await apiRequest(`/api/suppliers/${supplier.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to deactivate supplier");
      onToast("Supplier deactivated");
      closeDrawer();
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to deactivate supplier");
    } finally {
      setDeleteBusy(false);
      setPendingDelete(null);
    }
  }
  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountSupplier || !canManageLogins || !isValidEmail(accountForm.email)) return;
    setAccountSubmitting(true);
    try {
      const response = await apiRequest(`/api/suppliers/${accountSupplier.id}/account`, {
        method: "POST",
        body: JSON.stringify(accountForm),
      });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to create supplier account");
      setAccountSupplier(null);
      setAccountForm(emptyAccount);
      onToast("Supplier login created");
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to create supplier account");
    } finally {
      setAccountSubmitting(false);
    }
  }
  function supplierForm() {
    return (
      <form className="operational-drawer-form" onSubmit={save}>
        <TextField
          required
          label="Company name"
          value={form.companyName}
          onChange={(event) =>
            setForm((current) => ({ ...current, companyName: event.target.value }))
          }
        />
        <TextField
          label="Contact person"
          value={form.contactPerson}
          onChange={(event) =>
            setForm((current) => ({ ...current, contactPerson: event.target.value }))
          }
        />
        <div className="form-grid form-grid--two operational-form-grid">
          <TextField
            label="Contact number"
            type="tel"
            inputMode="numeric"
            maxLength={11}
            placeholder="09XXXXXXXXX"
            value={form.phone}
            error={phoneError}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))
            }
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            error={emailError}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </div>
        <p className="form-hint">Provide a contact number, an email address, or both.</p>
        <TextField
          label="Address"
          value={form.address}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
        />
        <TextField
          label="Notes"
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
        <SelectField
          label="Status"
          value={form.status}
          disabled={editing && !canDeactivate && selected?.status === "active"}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              status: event.target.value as SupplierForm["status"],
            }))
          }
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </SelectField>
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
          <Button type="submit" disabled={submitting || Boolean(phoneError || emailError)}>
            {submitting ? "Saving…" : editing ? "Save supplier" : "Create supplier"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="operational-workspace">
      <PageHeader
        title="Suppliers"
        action={
          <>
            <ViewToggle view={view} onChange={setView} label="Choose supplier view" />
            <Button icon="plus" onClick={openCreate}>
              Add supplier
            </Button>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--three">
        <MetricCard label="Suppliers" value={String(suppliers.length)} icon="users" accent="blue" />
        <MetricCard
          label="Active suppliers"
          value={String(suppliers.filter((supplier) => supplier.status === "active").length)}
          icon="check"
          accent="green"
        />
        <MetricCard
          label="Portal accounts"
          value={String(suppliers.filter((supplier) => supplier.hasAccount).length)}
          icon="lock"
          accent="amber"
        />
      </div>
      <Panel className="operational-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>Supplier relationships</h2>
          </div>
          <div className="inventory-catalog-count">
            <strong>{visible.length}</strong>
            <span>visible</span>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search suppliers"
          filters={
            <SelectField
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter suppliers by status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectField>
          }
          resultCount={visible.length}
        />
        {loading ? (
          <SkeletonCards label="Loading suppliers" />
        ) : loadError ? (
          <div className="operational-loading" role="alert">
            {loadError}
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon="users"
            title="No suppliers found"
            description="Create a supplier profile to link inventory and restock requests."
            action={
              <Button size="sm" icon="plus" onClick={openCreate}>
                Add supplier
              </Button>
            }
          />
        ) : view === "cards" ? (
          <div className="operational-card-grid">
            {visible.map((supplier) => (
              <RecordCard
                key={supplier.id}
                onOpen={() => void openDetails(supplier)}
                ariaLabel={`Open ${supplier.companyName}`}
              >
                <div className="operational-card__header">
                  <div className="operational-card__identity">
                    <span className="supplier-card-mark">
                      <Icon name="users" size={21} />
                    </span>
                    <div>
                      <strong>{supplier.companyName}</strong>
                      <small>{supplier.contactPerson || "Contact not set"}</small>
                    </div>
                  </div>
                  <Badge tone={supplier.status === "active" ? "success" : "danger"}>
                    {supplier.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="operational-card__note">
                  {supplier.email || "No email"}
                  <br />
                  {supplier.phone || "No phone"}
                </p>
                <div className="operational-card__facts">
                  <div>
                    <span>Portal access</span>
                    <strong>{supplier.hasAccount ? "Connected" : "Not set"}</strong>
                  </div>
                  <div>
                    <span>Contact coverage</span>
                    <strong>{supplier.email && supplier.phone ? "Complete" : "Partial"}</strong>
                  </div>
                </div>
              </RecordCard>
            ))}
          </div>
        ) : (
          <ResponsiveTable headers={["Supplier", "Contact", "Status", "Account", "Actions"]}>
            {visible.map((supplier) => (
              <tr
                key={supplier.id}
                tabIndex={0}
                onClick={() => void openDetails(supplier)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openDetails(supplier);
                  }
                }}
              >
                <td>
                  <strong>{supplier.companyName}</strong>
                  <small>{supplier.email || "No email"}</small>
                </td>
                <td>
                  <strong>{supplier.contactPerson || "Not set"}</strong>
                  <small>{supplier.phone || "No phone"}</small>
                </td>
                <td>
                  <Badge tone={supplier.status === "active" ? "success" : "danger"}>
                    {supplier.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td>{supplier.hasAccount ? "Connected" : "Not set"}</td>
                <td>
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="row-action row-action--icon"
                      type="button"
                      onClick={() => openEdit(supplier)}
                      aria-label={`Edit ${supplier.companyName}`}
                      title={`Edit ${supplier.companyName}`}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    {canManageLogins && !supplier.hasAccount && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setAccountSupplier(supplier);
                          setAccountForm({
                            firstName: supplier.contactPerson.split(" ")[0] ?? "",
                            lastName: supplier.contactPerson.split(" ").slice(1).join(" "),
                            email: supplier.email,
                            password: "",
                          });
                        }}
                      >
                        Create login
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </ResponsiveTable>
        )}
      </Panel>
      <SupplierItemsModal
        supplier={itemsSupplier}
        onClose={() => setItemsSupplier(null)}
        onSaved={(count) => {
          const supplier = itemsSupplier;
          setItemsSupplier(null);
          onToast(
            `${count} item${count === 1 ? "" : "s"} assigned to ${supplier?.companyName ?? "supplier"}`,
          );
          if (supplier && selected?.id === supplier.id) void openDetails(supplier);
        }}
      />
      <Modal
        open={createOpen}
        title="Add supplier"
        onClose={() => !submitting && setCreateOpen(false)}
      >
        {supplierForm()}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected?.companyName ?? "Supplier profile"}
        subtitle={selected ? selected.contactPerson || "Supplier relationship" : undefined}
        eyebrow="Supplier profile"
        onClose={closeDrawer}
        dirty={dirty}
        onDiscard={() => setEditing(false)}
      >
        {selected &&
          (editing ? (
            <DrawerSection eyebrow="Edit supplier" title="Update profile">
              {supplierForm()}
            </DrawerSection>
          ) : profileLoading ? (
            <SkeletonRows count={4} label="Loading supplier profile" />
          ) : profile ? (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <span className="supplier-card-mark supplier-card-mark--large">
                    <Icon name="users" size={25} />
                  </span>
                  <div>
                    <strong>{profile.supplier.email || "No email"}</strong>
                    <span>{profile.supplier.phone || "No phone on file"}</span>
                  </div>
                  <Badge tone={profile.supplier.status === "active" ? "success" : "danger"}>
                    {profile.supplier.status}
                  </Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Coverage" title="Supplier snapshot">
                <div className="operational-drawer__facts">
                  <div>
                    <span>Supplied items</span>
                    <strong>{profile.suppliedItems.length}</strong>
                  </div>
                  <div>
                    <span>Restock history</span>
                    <strong>{profile.restockHistory.length}</strong>
                  </div>
                  <div>
                    <span>Deliveries</span>
                    <strong>{profile.recentDeliveries.length}</strong>
                  </div>
                  <div>
                    <span>Portal access</span>
                    <strong>{profile.supplier.hasAccount ? "Connected" : "Not set"}</strong>
                  </div>
                </div>
              </DrawerSection>
              <DrawerSection
                eyebrow="Inventory"
                title="Supplied items"
                action={
                  selected.status === "active" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="box"
                      onClick={() => setItemsSupplier(selected)}
                    >
                      Assign items
                    </Button>
                  ) : undefined
                }
              >
                {profile.suppliedItems.length ? (
                  <div className="drawer-mini-list">
                    {profile.suppliedItems.slice(0, 5).map((item) => (
                      <div key={item.id}>
                        <strong>{item.name}</strong>
                        <span>
                          {item.quantity} {item.unit} · {item.branch}
                        </span>
                      </div>
                    ))}
                    {profile.suppliedItems.length > 5 && (
                      <p className="form-hint">+{profile.suppliedItems.length - 5} more</p>
                    )}
                  </div>
                ) : (
                  <p className="form-hint">
                    No items assigned yet. Assign the items this supplier provides so you can
                    request restocks from them.
                  </p>
                )}
              </DrawerSection>
              <DrawerSection eyebrow="Actions" title="Manage supplier">
                <div className="operational-drawer__actions">
                  <Button variant="secondary" icon="edit" onClick={() => openEdit(selected)}>
                    Edit profile
                  </Button>
                  {canManageLogins && !selected.hasAccount && (
                    <Button
                      variant="secondary"
                      icon="lock"
                      onClick={() => {
                        setAccountSupplier(selected);
                        setAccountForm({
                          firstName: selected.contactPerson.split(" ")[0] ?? "",
                          lastName: selected.contactPerson.split(" ").slice(1).join(" "),
                          email: selected.email,
                          password: "",
                        });
                      }}
                    >
                      Create login
                    </Button>
                  )}
                  {canDeactivate && selected.status === "active" && (
                    <Button variant="danger" onClick={() => setPendingDelete(selected)}>
                      Deactivate
                    </Button>
                  )}
                </div>
              </DrawerSection>
            </>
          ) : (
            <p className="form-hint">No profile data is available.</p>
          ))}
      </DetailDrawer>
      <Modal
        open={canManageLogins && Boolean(accountSupplier)}
        title={
          accountSupplier
            ? `Create login for ${accountSupplier.companyName}`
            : "Create supplier login"
        }
        onClose={() => !accountSubmitting && setAccountSupplier(null)}
      >
        <form className="modal-form" onSubmit={createAccount}>
          <div className="form-grid form-grid--two">
            <TextField
              required
              label="First name"
              value={accountForm.firstName}
              onChange={(event) =>
                setAccountForm((current) => ({ ...current, firstName: event.target.value }))
              }
            />
            <TextField
              required
              label="Last name"
              value={accountForm.lastName}
              onChange={(event) =>
                setAccountForm((current) => ({ ...current, lastName: event.target.value }))
              }
            />
          </div>
          <TextField
            required
            type="email"
            label="Email"
            value={accountForm.email}
            error={
              accountForm.email.trim() && !isValidEmail(accountForm.email)
                ? EMAIL_MESSAGE
                : undefined
            }
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, email: event.target.value }))
            }
          />
          <TextField
            required
            type="password"
            label="Temporary password"
            value={accountForm.password}
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, password: event.target.value }))
            }
          />
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={() => setAccountSupplier(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={accountSubmitting}>
              {accountSubmitting ? "Creating…" : "Create login"}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={canDeactivate && Boolean(pendingDelete)}
        title="Deactivate this supplier?"
        description={
          pendingDelete
            ? `${pendingDelete.companyName} will be hidden from active workflows while the record is retained.`
            : undefined
        }
        confirmLabel="Deactivate supplier"
        danger
        busy={deleteBusy}
        onClose={() => !deleteBusy && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deactivate(pendingDelete)}
      />
    </div>
  );
}
