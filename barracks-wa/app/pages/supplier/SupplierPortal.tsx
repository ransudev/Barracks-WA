"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApiUser } from "@/app/lib/api";
import { apiRequest, readApiBody } from "@/app/lib/api";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  SectionHeading,
  TextField,
} from "@/app/components/ui";
import { PortalTopbar } from "@/app/components/layout/PortalTopbar";
import { DetailDrawer, DrawerSection } from "@/app/components/operations/OperationalPrimitives";
import { Icon } from "@/app/components/ui/icons";

type SupplierRecord = {
  id: number;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: "active" | "inactive";
};
type SupplierForm = Pick<
  SupplierRecord,
  "companyName" | "contactPerson" | "phone" | "email" | "address" | "notes"
>;
type SupplierProfileResponse = {
  success: boolean;
  message?: string;
  profile?: {
    supplier: SupplierRecord;
    suppliedItems: Array<{
      id: number;
      name: string;
      category: string;
      quantity: number;
      minimum_stock: number;
      unit: string;
      sku: string | null;
      unit_cost: number | string;
      status: string;
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
      reference: string | null;
      notes: string;
      created_at: string;
      updated_at: string;
    }>;
  };
};

type RestockItem = {
  id: number;
  itemName: string;
  requestedQuantity: number;
  deliveredQuantity: number | null;
  unitCost?: number | string | null;
};
type Restock = {
  id: number;
  status: string;
  branch?: string;
  reference: string | null;
  notes?: string;
  created_at: string;
  updated_at?: string;
  received_at?: string | null;
  items: RestockItem[];
};
type Delivery = {
  id: number;
  status: string;
  branch: string;
  reference: string | null;
  received_at: string | null;
  created_at: string;
};
type OperationsDetail =
  { kind: "restock"; record: Restock } | { kind: "delivery"; record: Delivery };

function supplierFormFrom(record: SupplierRecord): SupplierForm {
  return {
    companyName: record.companyName,
    contactPerson: record.contactPerson,
    phone: record.phone,
    email: record.email,
    address: record.address,
    notes: record.notes,
  };
}

const supplierTransitions: Record<string, string | undefined> = {
  Pending: "Accepted",
  Accepted: "Preparing",
  Preparing: "Shipped",
};

function restockTone(status: string): "danger" | "success" | "warning" {
  if (status === "Cancelled") return "danger";
  if (status === "Received") return "success";
  return "warning";
}

function formatDeliveryDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString([], { dateStyle: "medium" }) : "Received";
}

function formatRecordDate(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Not recorded";
}

export function SupplierPortal({
  user,
  onSignOut,
  onToast,
}: {
  user: ApiUser;
  onSignOut: () => void;
  onToast: (message: string) => void;
}) {
  const [profile, setProfile] = useState<SupplierProfileResponse["profile"]>();
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<SupplierForm | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [operationsDetail, setOperationsDetail] = useState<OperationsDetail | null>(null);
  const [requestsDrawerOpen, setRequestsDrawerOpen] = useState(false);
  const [deliveriesDrawerOpen, setDeliveriesDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResponse, restockResponse] = await Promise.all([
        apiRequest("/api/supplier/me", { cache: "no-store" }),
        apiRequest("/api/restocks", { cache: "no-store" }),
      ]);
      const profileBody = await readApiBody<SupplierProfileResponse>(profileResponse);
      const restockBody = await readApiBody<{
        success: boolean;
        restocks?: Restock[];
        message?: string;
      }>(restockResponse);
      if (!profileResponse.ok || !profileBody?.success || !profileBody.profile)
        throw new Error(profileBody?.message ?? "Unable to load supplier profile");
      if (!restockResponse.ok || !restockBody?.success)
        throw new Error(restockBody?.message ?? "Unable to load restock requests");
      setProfile(profileBody.profile);
      setRestocks(restockBody.restocks ?? []);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to load supplier portal");
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

  async function advance(restock: Restock) {
    const next = supplierTransitions[restock.status];
    if (!next) return false;
    const response = await apiRequest(`/api/restocks/${restock.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    const body = await readApiBody<{ success: boolean; message?: string }>(response);
    if (!response.ok || !body?.success) {
      onToast(body?.message ?? "Unable to update restock");
      return false;
    }
    onToast(`Restock marked ${next}`);
    await load();
    return true;
  }

  function openRestockDrawer(restock: Restock) {
    setRequestsDrawerOpen(false);
    setOperationsDetail({ kind: "restock", record: restock });
  }

  function openDeliveryDrawer(delivery: Delivery) {
    setDeliveriesDrawerOpen(false);
    setOperationsDetail({ kind: "delivery", record: delivery });
  }

  function closeOperationsDrawer() {
    setOperationsDetail(null);
  }

  function openRequestsDrawer() {
    setRequestsDrawerOpen(true);
  }

  function closeRequestsDrawer() {
    setRequestsDrawerOpen(false);
  }

  function openDeliveriesDrawer() {
    setDeliveriesDrawerOpen(true);
  }

  function closeDeliveriesDrawer() {
    setDeliveriesDrawerOpen(false);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      onToast("New passwords do not match");
      return;
    }
    setSavingPassword(true);
    try {
      const response = await apiRequest("/api/supplier/account", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to update password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onToast("Password updated");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to update password");
    } finally {
      setSavingPassword(false);
    }
  }

  function openProfileDrawer() {
    if (!supplier) return;
    setProfileForm(supplierFormFrom(supplier));
    setProfileError("");
    setEditingProfile(true);
    setProfileDrawerOpen(true);
  }

  function closeProfileDrawer() {
    if (savingProfile) return;
    setProfileDrawerOpen(false);
    setEditingProfile(false);
    setProfileForm(null);
    setProfileError("");
  }

  function cancelProfileEditing() {
    if (supplier) setProfileForm(supplierFormFrom(supplier));
    setProfileError("");
    setEditingProfile(false);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profileForm) return;
    setProfileError("");
    setSavingProfile(true);
    try {
      const response = await apiRequest("/api/supplier/me", {
        method: "PATCH",
        body: JSON.stringify(profileForm),
      });
      const body = await readApiBody<{
        success: boolean;
        supplier?: SupplierRecord;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.supplier) {
        const details = body?.errors ? Object.values(body.errors).flat().join(" ") : body?.message;
        throw new Error(details ?? "Unable to update supplier details");
      }
      setProfile((current) => (current ? { ...current, supplier: body.supplier! } : current));
      setProfileForm(supplierFormFrom(body.supplier));
      setEditingProfile(false);
      onToast("Supplier details updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update supplier details";
      setProfileError(message);
      onToast(message);
    } finally {
      setSavingProfile(false);
    }
  }

  const pending = restocks.filter((restock) => !["Received", "Cancelled"].includes(restock.status));
  const supplier = profile?.supplier;
  const supplierInitials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
  const profileDirty = Boolean(
    supplier &&
    profileForm &&
    JSON.stringify(profileForm) !== JSON.stringify(supplierFormFrom(supplier)),
  );
  const matchingDeliveryRequest =
    operationsDetail?.kind === "delivery"
      ? restocks.find((restock) => restock.id === operationsDetail.record.id)
      : undefined;
  const requestPreview = restocks.slice(0, 3);
  const deliveryPreview = profile?.recentDeliveries.slice(0, 3) ?? [];

  function renderRestockRow(restock: Restock) {
    const next = supplierTransitions[restock.status];
    const items = restock.items
      .map((item) => `${item.itemName} × ${item.requestedQuantity}`)
      .join(", ");
    return (
      <article className="supplier-request-row" key={restock.id}>
        <button
          className="supplier-request-row__trigger"
          type="button"
          onClick={() => openRestockDrawer(restock)}
          aria-label={`View request ${restock.id} details`}
        >
          <span className="supplier-request-row__details">
            <span>
              <strong>Request #{restock.id}</strong>
              <span>{restock.reference ?? "No reference"}</span>
            </span>
            <span className="supplier-request-row__items">{items || "No line items"}</span>
          </span>
        </button>
        <div className="supplier-request-row__actions">
          <Badge tone={restockTone(restock.status)}>{restock.status}</Badge>
          {next && (
            <Button size="sm" onClick={() => void advance(restock)}>
              Mark {next}
            </Button>
          )}
        </div>
      </article>
    );
  }

  function renderDeliveryRow(delivery: Delivery) {
    return (
      <button
        className="supplier-delivery-row"
        type="button"
        key={delivery.id}
        onClick={() => openDeliveryDrawer(delivery)}
        aria-label={`View delivery ${delivery.id} details`}
      >
        <div>
          <strong>Request #{delivery.id}</strong>
          <span>{delivery.reference ?? "No reference"}</span>
        </div>
        <span className="supplier-delivery-row__date">
          {formatDeliveryDate(delivery.received_at)}
        </span>
        <Icon name="chevronRight" size={15} />
      </button>
    );
  }

  return (
    <main className="supplier-portal">
      <PortalTopbar
        onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        name={`${user.firstName} ${user.lastName}`.trim() || "Supplier"}
        role="Supplier"
        tone="green"
        onSignOut={onSignOut}
      />

      <div className="supplier-portal__content">
        <PageHeader title={supplier?.companyName ?? "Supplier dashboard"} />

        <div className="metrics-grid metrics-grid--three supplier-portal__metrics">
          <MetricCard
            label="Linked items"
            value={String(profile?.suppliedItems.length ?? 0)}
            icon="box"
            accent="blue"
          />
          <MetricCard
            label="Open requests"
            value={String(pending.length)}
            icon="info"
            accent="amber"
          />
          <MetricCard
            label="Received deliveries"
            value={String(profile?.recentDeliveries.length ?? 0)}
            icon="check"
            accent="green"
          />
        </div>

        <div className="supplier-portal__grid">
          <Panel className="supplier-profile-card">
            <SectionHeading
              title="Supplier profile"
              action={
                supplier ? (
                  <button className="link-button" type="button" onClick={openProfileDrawer}>
                    Edit details
                  </button>
                ) : undefined
              }
            />
            {loading ? (
              <SkeletonRows count={5} label="Loading supplier details" />
            ) : profile ? (
              <>
                <div className="supplier-profile-card__identity">
                  <Avatar initials={supplierInitials || "SP"} tone="green" size="lg" />
                  <div>
                    <h3>{profile.supplier.companyName}</h3>
                    <p>{profile.supplier.contactPerson || "No contact person set"}</p>
                  </div>
                  <Badge tone={profile.supplier.status === "active" ? "success" : "danger"}>
                    {profile.supplier.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <dl className="supplier-profile-card__facts">
                  <div>
                    <dt>Email</dt>
                    <dd title={profile.supplier.email || undefined}>
                      {profile.supplier.email || "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{profile.supplier.phone || "Not set"}</dd>
                  </div>
                  <div className="supplier-profile-card__facts-wide">
                    <dt>Address</dt>
                    <dd title={profile.supplier.address || undefined}>
                      {profile.supplier.address || "Not set"}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <EmptyState
                icon="users"
                title="No supplier profile"
                description="Ask an administrator to link this account to a supplier profile."
              />
            )}
          </Panel>

          <Panel className="supplier-requests-panel">
            <SectionHeading
              title="Restock requests"
              action={
                restocks.length > requestPreview.length ? (
                  <button className="link-button" type="button" onClick={openRequestsDrawer}>
                    View all {restocks.length}
                  </button>
                ) : undefined
              }
            />
            {restocks.length ? (
              <div className="supplier-request-list">{requestPreview.map(renderRestockRow)}</div>
            ) : (
              <p className="supplier-portal__empty-copy">No restock requests yet.</p>
            )}
          </Panel>

          <Panel className="supplier-items-panel">
            <SectionHeading title="Supplied items" />
            {profile?.suppliedItems.length ? (
              <div className="supplier-item-list panel-scroll-body" role="list">
                {profile.suppliedItems.map((item) => {
                  const isLowStock = item.quantity <= item.minimum_stock;
                  return (
                    <div className="supplier-item-row" key={item.id} role="listitem">
                      <div className="supplier-item-row__product">
                        <strong>{item.name}</strong>
                        <span>
                          {item.category} · {item.sku ?? "No SKU"}
                        </span>
                      </div>
                      <div className="supplier-item-row__quantity">
                        <strong>
                          {item.quantity} <small>{item.unit}</small>
                        </strong>
                      </div>
                      <div className="supplier-item-row__status">
                        <Badge tone={isLowStock ? "warning" : "success"}>
                          {isLowStock ? "Low stock" : "In stock"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="supplier-portal__empty-copy">No linked items yet.</p>
            )}
          </Panel>

          <Panel className="supplier-deliveries-panel">
            <SectionHeading
              title="Delivery history"
              action={
                (profile?.recentDeliveries.length ?? 0) > deliveryPreview.length ? (
                  <button className="link-button" type="button" onClick={openDeliveriesDrawer}>
                    View all {profile?.recentDeliveries.length}
                  </button>
                ) : undefined
              }
            />
            {profile?.recentDeliveries.length ? (
              <div className="supplier-delivery-list">{deliveryPreview.map(renderDeliveryRow)}</div>
            ) : (
              <p className="supplier-portal__empty-copy">No received deliveries yet.</p>
            )}
          </Panel>
        </div>

        <Panel className="supplier-account-panel">
          <SectionHeading title="Change password" />
          <form className="supplier-password-form" onSubmit={changePassword}>
            <div className="supplier-password-form__fields">
              <TextField
                required
                type="password"
                label="Current password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <TextField
                required
                type="password"
                label="New password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <TextField
                required
                type="password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <Button type="submit" disabled={savingPassword} icon="lock">
                {savingPassword ? "Updating…" : "Update"}
              </Button>
            </div>
          </form>
        </Panel>

        <DetailDrawer
          open={profileDrawerOpen && Boolean(supplier)}
          title={supplier?.companyName ?? "Supplier details"}
          subtitle={
            supplier?.contactPerson || "Update the details linked to your supplier account."
          }
          eyebrow="Supplier profile"
          onClose={closeProfileDrawer}
          dirty={editingProfile && profileDirty}
          onDiscard={cancelProfileEditing}
        >
          {supplier && editingProfile && profileForm ? (
            <DrawerSection eyebrow="Edit profile" title="Update supplier details">
              <form
                className="operational-drawer-form supplier-profile-form"
                onSubmit={saveProfile}
              >
                <TextField
                  required
                  label="Company name"
                  value={profileForm.companyName}
                  onChange={(event) =>
                    setProfileForm((current) =>
                      current ? { ...current, companyName: event.target.value } : current,
                    )
                  }
                />
                <TextField
                  label="Contact person"
                  value={profileForm.contactPerson}
                  onChange={(event) =>
                    setProfileForm((current) =>
                      current ? { ...current, contactPerson: event.target.value } : current,
                    )
                  }
                />
                <div className="form-grid form-grid--two operational-form-grid">
                  <TextField
                    label="Phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    value={profileForm.phone}
                    onChange={(event) =>
                      setProfileForm((current) =>
                        current ? { ...current, phone: event.target.value } : current,
                      )
                    }
                  />
                  <TextField
                    label="Email"
                    type="email"
                    value={profileForm.email}
                    onChange={(event) =>
                      setProfileForm((current) =>
                        current ? { ...current, email: event.target.value } : current,
                      )
                    }
                  />
                </div>
                <TextField
                  label="Address"
                  value={profileForm.address}
                  onChange={(event) =>
                    setProfileForm((current) =>
                      current ? { ...current, address: event.target.value } : current,
                    )
                  }
                />
                <label className="field">
                  <span className="field__label">Notes</span>
                  <textarea
                    value={profileForm.notes}
                    onChange={(event) =>
                      setProfileForm((current) =>
                        current ? { ...current, notes: event.target.value } : current,
                      )
                    }
                    rows={4}
                  />
                </label>
                {profileError && (
                  <p className="form-error" role="alert">
                    {profileError}
                  </p>
                )}
                <div className="modal-actions">
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={savingProfile}
                    onClick={cancelProfileEditing}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingProfile}>
                    {savingProfile ? "Saving…" : "Save details"}
                  </Button>
                </div>
              </form>
            </DrawerSection>
          ) : supplier ? (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials={supplierInitials || "SP"} tone="slate" size="lg" />
                  <div>
                    <strong>{supplier.companyName}</strong>
                    <span>{supplier.contactPerson || "No contact person set"}</span>
                  </div>
                  <Badge tone={supplier.status === "active" ? "success" : "danger"}>
                    {supplier.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Contact" title="Supplier details">
                <div className="operational-drawer__facts supplier-drawer-facts">
                  <div>
                    <span>Contact email</span>
                    <strong title={supplier.email || "Not set"}>
                      {supplier.email || "Not set"}
                    </strong>
                  </div>
                  <div>
                    <span>Phone</span>
                    <strong title={supplier.phone || "Not set"}>
                      {supplier.phone || "Not set"}
                    </strong>
                  </div>
                  <div>
                    <span>Address</span>
                    <strong title={supplier.address || "Not set"}>
                      {supplier.address || "Not set"}
                    </strong>
                  </div>
                  <div>
                    <span>Login email</span>
                    <strong title={user.email}>{user.email}</strong>
                  </div>
                  <div className="supplier-drawer-facts__wide">
                    <span>Notes</span>
                    <strong title={supplier.notes || "No notes"}>
                      {supplier.notes || "No notes"}
                    </strong>
                  </div>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Actions" title="Manage details">
                <div className="operational-drawer__actions">
                  <Button
                    variant="secondary"
                    icon="edit"
                    onClick={() => {
                      setProfileForm(supplierFormFrom(supplier));
                      setProfileError("");
                      setEditingProfile(true);
                    }}
                  >
                    Edit details
                  </Button>
                </div>
              </DrawerSection>
            </>
          ) : null}
        </DetailDrawer>

        <DetailDrawer
          open={Boolean(operationsDetail)}
          title={
            operationsDetail?.kind === "delivery"
              ? `Delivery #${operationsDetail.record.id}`
              : operationsDetail
                ? `Request #${operationsDetail.record.id}`
                : "Operations detail"
          }
          subtitle={operationsDetail?.record.reference ?? "No reference"}
          eyebrow={operationsDetail?.kind === "delivery" ? "Delivery history" : "Restock request"}
          onClose={closeOperationsDrawer}
        >
          {operationsDetail?.kind === "restock" ? (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials="RQ" tone="slate" size="lg" />
                  <div>
                    <strong>Request #{operationsDetail.record.id}</strong>
                    <span>{operationsDetail.record.reference ?? "No reference"}</span>
                  </div>
                  <Badge tone={restockTone(operationsDetail.record.status)}>
                    {operationsDetail.record.status}
                  </Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Request details" title="Request information">
                <div className="operational-drawer__facts supplier-drawer-facts">
                  <div>
                    <span>Branch</span>
                    <strong>{operationsDetail.record.branch || "Not recorded"}</strong>
                  </div>
                  <div>
                    <span>Reference</span>
                    <strong>{operationsDetail.record.reference || "Not recorded"}</strong>
                  </div>
                  <div>
                    <span>Created</span>
                    <strong>{formatRecordDate(operationsDetail.record.created_at)}</strong>
                  </div>
                  <div>
                    <span>Last updated</span>
                    <strong>{formatRecordDate(operationsDetail.record.updated_at)}</strong>
                  </div>
                  {operationsDetail.record.notes && (
                    <div className="supplier-drawer-facts__wide">
                      <span>Notes</span>
                      <strong>{operationsDetail.record.notes}</strong>
                    </div>
                  )}
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Line items" title="Requested items">
                <div className="supplier-drawer-line-list">
                  {operationsDetail.record.items.length ? (
                    operationsDetail.record.items.map((item) => (
                      <div className="supplier-drawer-line" key={item.id}>
                        <div>
                          <strong>{item.itemName}</strong>
                          <span>Requested {item.requestedQuantity}</span>
                        </div>
                        <Badge tone={item.deliveredQuantity === null ? "warning" : "success"}>
                          {item.deliveredQuantity === null
                            ? "Pending"
                            : `${item.deliveredQuantity} delivered`}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <p className="supplier-portal__empty-copy">No line items recorded.</p>
                  )}
                </div>
              </DrawerSection>
              {supplierTransitions[operationsDetail.record.status] && (
                <DrawerSection eyebrow="Next step" title="Update request">
                  <div className="operational-drawer__actions">
                    <Button
                      icon="arrowRight"
                      onClick={async () => {
                        const changed = await advance(operationsDetail.record);
                        if (changed) closeOperationsDrawer();
                      }}
                    >
                      Mark {supplierTransitions[operationsDetail.record.status]}
                    </Button>
                  </div>
                </DrawerSection>
              )}
            </>
          ) : operationsDetail?.kind === "delivery" ? (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar initials="DL" tone="green" size="lg" />
                  <div>
                    <strong>Request #{operationsDetail.record.id}</strong>
                    <span>{operationsDetail.record.reference ?? "No reference"}</span>
                  </div>
                  <Badge tone="success">Received</Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Delivery details" title="Receipt information">
                <div className="operational-drawer__facts supplier-drawer-facts">
                  <div>
                    <span>Branch</span>
                    <strong>{operationsDetail.record.branch || "Not recorded"}</strong>
                  </div>
                  <div>
                    <span>Reference</span>
                    <strong>{operationsDetail.record.reference || "Not recorded"}</strong>
                  </div>
                  <div>
                    <span>Received</span>
                    <strong>{formatRecordDate(operationsDetail.record.received_at)}</strong>
                  </div>
                  <div>
                    <span>Created</span>
                    <strong>{formatRecordDate(operationsDetail.record.created_at)}</strong>
                  </div>
                </div>
              </DrawerSection>
              {matchingDeliveryRequest && (
                <DrawerSection eyebrow="Request context" title="Supplied items">
                  <div className="supplier-drawer-line-list">
                    {matchingDeliveryRequest.items.map((item) => (
                      <div className="supplier-drawer-line" key={item.id}>
                        <div>
                          <strong>{item.itemName}</strong>
                          <span>Requested {item.requestedQuantity}</span>
                        </div>
                        <Badge tone="success">{item.deliveredQuantity ?? 0} delivered</Badge>
                      </div>
                    ))}
                  </div>
                  {matchingDeliveryRequest.notes && (
                    <p className="supplier-drawer-note">{matchingDeliveryRequest.notes}</p>
                  )}
                </DrawerSection>
              )}
            </>
          ) : null}
        </DetailDrawer>

        <DetailDrawer
          open={requestsDrawerOpen}
          title="Restock requests"
          subtitle={`${restocks.length} request${restocks.length === 1 ? "" : "s"} linked to your account`}
          eyebrow="Request queue"
          onClose={closeRequestsDrawer}
        >
          <DrawerSection eyebrow="All requests" title="Request history">
            <div className="supplier-request-list supplier-request-list--drawer">
              {restocks.map(renderRestockRow)}
            </div>
          </DrawerSection>
        </DetailDrawer>

        <DetailDrawer
          open={deliveriesDrawerOpen}
          title="Delivery history"
          subtitle={`${profile?.recentDeliveries.length ?? 0} ${profile?.recentDeliveries.length === 1 ? "delivery" : "deliveries"} linked to your account`}
          eyebrow="Delivery archive"
          onClose={closeDeliveriesDrawer}
        >
          <DrawerSection eyebrow="All deliveries" title="Delivery history">
            <div className="supplier-delivery-list supplier-delivery-list--drawer">
              {(profile?.recentDeliveries ?? []).map(renderDeliveryRow)}
            </div>
          </DrawerSection>
        </DetailDrawer>
      </div>
    </main>
  );
}
