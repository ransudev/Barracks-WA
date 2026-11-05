"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { emailFieldError } from "@/app/utils/contact-validation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, readApiBody, type ApiRole, type ApiUser } from "@/app/lib/api";
import {
  canChangeStaffLifecycle,
  canCreateStaffUser,
  canDeactivateStaffUser,
  canUpdateStaffUser,
  canViewStaffUser,
  roleLabel,
  roleOptions,
} from "@/app/constants/roles";
import { createInitials } from "@/app/utils/format";
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
import {
  DetailDrawer,
  DrawerSection,
  FilterToolbar,
  RecordCard,
  ResponsiveTable,
  ViewToggle,
  type OperationalViewMode,
} from "@/app/components/operations/OperationalPrimitives";

type AccountStatus = "active" | "pending" | "blocked";
type LifecycleAction = "verify" | "unverify" | "block" | "unblock";
type AccountForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: ApiRole;
};
const emptyForm: AccountForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  role: "front_desk",
};

function displayName(user: ApiUser) {
  return `${user.firstName} ${user.lastName}`.trim();
}
function accountStatus(user: ApiUser): AccountStatus {
  return user.isBlocked ? "blocked" : !user.isVerified ? "pending" : "active";
}
function accountStatusLabel(status: AccountStatus) {
  return status === "active" ? "Active" : status === "pending" ? "Pending verification" : "Blocked";
}
function statusTone(status: AccountStatus): "success" | "warning" | "danger" {
  return status === "active" ? "success" : status === "pending" ? "warning" : "danger";
}
function responseMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
) {
  return body?.errors
    ? Object.values(body.errors).flat().join(" ") || body?.message || fallback
    : body?.message || fallback;
}

export function StaffManagement({
  onToast,
  currentUserId,
  currentUserRole,
}: {
  onToast: (message: string) => void;
  currentUserId: number;
  currentUserRole: ApiRole;
}) {
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedBranches, setSelectedBranches] = useState<number[]>([]);
  const [items, setItems] = useState<ApiUser[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ApiRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [view, setView] = useState<OperationalViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<ApiUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [pendingLifecycle, setPendingLifecycle] = useState<{
    user: ApiUser;
    action: LifecycleAction;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiUser | null>(null);
  const [busy, setBusy] = useState(false);

  const availableRoleOptions = useMemo(
    () => roleOptions.filter((option) => canCreateStaffUser(currentUserRole, option.value)),
    [currentUserRole],
  );
  const visibleRoleOptions = useMemo(
    () => roleOptions.filter((option) => canViewStaffUser(currentUserRole, option.value)),
    [currentUserRole],
  );
  const managesFrontDeskOnly = !canCreateStaffUser(currentUserRole, "manager");
  const canCreateAccounts = availableRoleOptions.length > 0;
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest("/api/users", { cache: "no-store" });
      const body = await readApiBody<{
        success: boolean;
        users?: ApiUser[];
        branches?: Array<{ id: number; name: string }>;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.users)
        throw new Error(body?.message ?? "Unable to load user accounts");
      setItems(body.users.filter((user) => canViewStaffUser(currentUserRole, user.role)));
      setBranches(body.branches ?? []);
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load user accounts";
      setLoadError(message);
      onToast(message);
    } finally {
      setLoading(false);
    }
  }, [currentUserRole, onToast]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadUsers();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadUsers]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (user) =>
        (!query ||
          `${displayName(user)} ${user.email} ${roleLabel(user.role)}`
            .toLowerCase()
            .includes(query)) &&
        (roleFilter === "all" || user.role === roleFilter) &&
        (statusFilter === "all" || accountStatus(user) === statusFilter),
    );
  }, [items, search, roleFilter, statusFilter]);
  const dirty = Boolean(
    selected &&
    editing &&
    JSON.stringify({ ...form, password: "" }) !==
      JSON.stringify({
        firstName: selected.firstName,
        lastName: selected.lastName,
        email: selected.email,
        password: "",
        role: selected.role,
      }),
  );
  const activeCount = items.filter((user) => accountStatus(user) === "active").length;
  const pendingCount = items.filter((user) => accountStatus(user) === "pending").length;
  const blockedCount = items.filter((user) => accountStatus(user) === "blocked").length;
  const selectedCanEdit = selected ? canEditUser(selected) : false;
  const selectedCanChangeLifecycle = selected ? canChangeLifecycle(selected) : false;
  const selectedCanDeactivate = selected ? canDeactivateUser(selected) : false;

  function canEditUser(user: ApiUser, desiredRole = user.role) {
    return (
      (currentUserRole === "administrator" || user.canManageAccount === true) &&
      canUpdateStaffUser(currentUserRole, user.role, currentUserId, user.id, desiredRole)
    );
  }
  function canChangeLifecycle(user: ApiUser) {
    return (
      (currentUserRole === "administrator" || user.canManageAccount === true) &&
      canChangeStaffLifecycle(currentUserRole, user.role, currentUserId, user.id)
    );
  }
  function canDeactivateUser(user: ApiUser) {
    return (
      (currentUserRole === "administrator" || user.canManageAccount === true) &&
      canDeactivateStaffUser(currentUserRole, user.role, currentUserId, user.id)
    );
  }
  function openCreate() {
    if (!canCreateAccounts) return;
    setForm(emptyForm);
    setSelectedBranches([]);
    setFormError("");
    setCreateOpen(true);
  }
  function openDetails(user: ApiUser) {
    setSelected(user);
    setEditing(false);
  }
  function openEdit(user: ApiUser) {
    if (!canEditUser(user)) return;
    setSelected(user);
    setForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: "",
      role: user.role,
    });
    setFormError("");
    setEditing(true);
  }
  function closeDrawer() {
    setSelected(null);
    setEditing(false);
    setFormError("");
  }
  async function saveUser(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (editing && (!selected || !canEditUser(selected))) {
      setFormError("You do not have permission to edit this account.");
      return;
    }
    if (!editing && !canCreateStaffUser(currentUserRole, form.role)) {
      setFormError("You do not have permission to create this role.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...(!editing ? { branchIds: form.role === "administrator" ? [] : selectedBranches } : {}),
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        role: form.role,
        ...(form.password ? { password: form.password } : {}),
      };
      const response = await apiRequest(
        editing && selected ? `/api/users/${selected.id}` : "/api/users",
        { method: editing && selected ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      const body = await readApiBody<{
        success: boolean;
        user?: ApiUser;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.user)
        throw new Error(responseMessage(body, "Unable to save user account"));
      setItems((current) =>
        editing
          ? current.map((item) => (item.id === body.user!.id ? body.user! : item))
          : [body.user!, ...current],
      );
      if (editing) {
        setSelected(body.user);
        setEditing(false);
      } else {
        setCreateOpen(false);
      }
      onToast(`${displayName(body.user)} ${editing ? "updated" : "created"}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save user account");
    } finally {
      setSubmitting(false);
    }
  }
  async function changeLifecycle(user: ApiUser, action: LifecycleAction) {
    if (!canChangeLifecycle(user)) {
      setPendingLifecycle(null);
      return;
    }
    setBusy(true);
    try {
      const response = await apiRequest(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      const body = await readApiBody<{
        success: boolean;
        user?: ApiUser;
        message?: string;
        errors?: Record<string, string[]>;
      }>(response);
      if (!response.ok || !body?.success || !body.user)
        throw new Error(responseMessage(body, "Unable to update account status"));
      setItems((current) => current.map((item) => (item.id === body.user!.id ? body.user! : item)));
      setSelected(body.user);
      onToast(
        `${displayName(body.user)} is now ${accountStatusLabel(accountStatus(body.user)).toLowerCase()}`,
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to update account status");
    } finally {
      setBusy(false);
      setPendingLifecycle(null);
    }
  }
  async function deleteUser(user: ApiUser) {
    if (!canDeactivateUser(user)) {
      setPendingDelete(null);
      return;
    }
    setBusy(true);
    try {
      const response = await apiRequest(`/api/users/${user.id}`, { method: "DELETE" });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to deactivate user account");
      setItems((current) => current.filter((item) => item.id !== user.id));
      if (selected?.id === user.id) closeDrawer();
      onToast(`${displayName(user)} deactivated; the record was retained`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Unable to deactivate user account");
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }
  function requestLifecycle(user: ApiUser, action: LifecycleAction) {
    if (!canChangeLifecycle(user)) return;
    if (action === "block" || action === "unverify") setPendingLifecycle({ user, action });
    else void changeLifecycle(user, action);
  }
  function userForm() {
    const formRoleOptions =
      editing && selected
        ? availableRoleOptions.filter((option) => canEditUser(selected, option.value))
        : availableRoleOptions;
    return (
      <form className="operational-drawer-form" onSubmit={saveUser}>
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
        <TextField
          label="Email address"
          type="email"
          required
          value={form.email}
          error={emailFieldError(form.email)}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          icon="mail"
        />
        <TextField
          label={editing ? "New password (optional)" : "Password"}
          type="password"
          required={!editing}
          minLength={8}
          value={form.password}
          onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
          icon="lock"
        />
        <SelectField
          label="Role"
          required
          value={form.role}
          onChange={(event) =>
            setForm((current) => ({ ...current, role: event.target.value as ApiRole }))
          }
        >
          {formRoleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {!editing && form.role !== "administrator" && (
          <fieldset>
            <legend>Initial branches{currentUserRole === "manager" ? " (required)" : ""}</legend>
            {branches.map((branch) => (
              <label key={branch.id}>
                <input
                  type="checkbox"
                  checked={selectedBranches.includes(branch.id)}
                  onChange={(event) =>
                    setSelectedBranches((current) =>
                      event.target.checked
                        ? [...current, branch.id]
                        : current.filter((id) => id !== branch.id),
                    )
                  }
                />{" "}
                {branch.name}
              </label>
            ))}
            {!branches.length && <p className="form-hint">No assigned branches are available.</p>}
          </fieldset>
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
          <Button
            type="submit"
            icon="check"
            disabled={
              submitting || (!editing && currentUserRole === "manager" && !selectedBranches.length)
            }
          >
            {submitting ? "Saving…" : editing ? "Save changes" : "Create account"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="operational-workspace">
      <PageHeader
        title={managesFrontDeskOnly ? "Front Desk accounts" : "User management"}
        description={
          managesFrontDeskOnly
            ? "View assigned Front Desk accounts; manage accounts only when every assigned branch is within your authority."
            : undefined
        }
        action={
          <>
            <ViewToggle view={view} onChange={setView} label="Choose staff view" />
            {canCreateAccounts && (
              <Button icon="userPlus" onClick={openCreate}>
                Create account
              </Button>
            )}
          </>
        }
      />
      <div className="metrics-grid metrics-grid--four">
        <MetricCard
          label="Total accounts"
          value={String(items.length)}
          icon="users"
          accent="blue"
        />
        <MetricCard
          label="Active & verified"
          value={String(activeCount)}
          icon="checkCircle"
          accent="green"
        />
        <MetricCard
          label="Pending verification"
          value={String(pendingCount)}
          icon="clock"
          accent="amber"
        />
        <MetricCard label="Blocked" value={String(blockedCount)} icon="lock" accent="red" />
      </div>
      <Panel className="operational-panel">
        <div className="inventory-catalog-head">
          <div>
            <h2>Staff accounts</h2>
          </div>
          <div className="inventory-catalog-count">
            <strong>{visible.length}</strong>
            <span>visible</span>
          </div>
        </div>
        <FilterToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search accounts"
          filters={
            <>
              <SelectField
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as "all" | ApiRole)}
                aria-label="Filter accounts by role"
              >
                <option value="all">All roles</option>
                {visibleRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | AccountStatus)}
                aria-label="Filter accounts by status"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending verification</option>
                <option value="blocked">Blocked</option>
              </SelectField>
            </>
          }
          resultCount={visible.length}
        />
        {loading ? (
          <SkeletonRows count={6} label="Loading user accounts" />
        ) : loadError ? (
          <div className="operational-loading" role="alert">
            {loadError}
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon="users"
            title="No accounts found"
            description="Try another search or filter, or create a new staff account."
            action={
              canCreateAccounts ? (
                <Button size="sm" icon="userPlus" onClick={openCreate}>
                  Create account
                </Button>
              ) : undefined
            }
          />
        ) : view === "cards" ? (
          <div className="operational-card-grid">
            {visible.map((user) => {
              const status = accountStatus(user);
              return (
                <RecordCard
                  key={user.id}
                  onOpen={() => openDetails(user)}
                  ariaLabel={`Open ${displayName(user)}`}
                >
                  <div className="operational-card__header">
                    <div className="operational-card__identity">
                      <Avatar
                        initials={createInitials(displayName(user))}
                        tone={user.role === "administrator" ? "violet" : "blue"}
                        size="md"
                      />
                      <div>
                        <strong>{displayName(user)}</strong>
                        <small>{roleLabel(user.role)}</small>
                      </div>
                    </div>
                    <Badge tone={statusTone(status)}>{accountStatusLabel(status)}</Badge>
                  </div>
                  <p className="operational-card__note">{user.email}</p>
                  <div className="operational-card__facts">
                    <div>
                      <span>Verification</span>
                      <strong>{user.isVerified ? "Verified" : "Unverified"}</strong>
                    </div>
                    <div>
                      <span>Joined</span>
                      <strong>
                        {new Date(user.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          year: "numeric",
                        })}
                      </strong>
                    </div>
                  </div>
                </RecordCard>
              );
            })}
          </div>
        ) : (
          <ResponsiveTable headers={["Name", "Role", "Email", "Access", "Joined", "Actions"]}>
            {visible.map((user) => {
              const status = accountStatus(user);
              const canEdit = canEditUser(user);
              const canDeactivate = canDeactivateUser(user);
              return (
                <tr
                  key={user.id}
                  tabIndex={0}
                  onClick={() => openDetails(user)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDetails(user);
                    }
                  }}
                >
                  <td>
                    <span className="table-person">
                      <Avatar
                        initials={createInitials(displayName(user))}
                        tone={user.role === "administrator" ? "violet" : "blue"}
                        size="sm"
                      />
                      <span>
                        <strong>{displayName(user)}</strong>
                        <small>{user.email}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Badge tone={user.role === "administrator" ? "purple" : "neutral"}>
                      {roleLabel(user.role)}
                    </Badge>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <Badge tone={statusTone(status)}>{accountStatusLabel(status)}</Badge>
                  </td>
                  <td>
                    {new Date(user.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    {(canEdit || canDeactivate) && (
                      <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                        {canEdit && (
                          <button
                            className="row-action row-action--icon"
                            type="button"
                            onClick={() => openEdit(user)}
                            aria-label={`Edit ${displayName(user)}`}
                            title={`Edit ${displayName(user)}`}
                          >
                            <Icon name="edit" size={16} />
                          </button>
                        )}
                        {canDeactivate && (
                          <button
                            className="row-action row-action--icon row-action--danger"
                            type="button"
                            onClick={() => setPendingDelete(user)}
                            aria-label={`Deactivate ${displayName(user)}`}
                            title={`Deactivate ${displayName(user)}`}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </ResponsiveTable>
        )}
      </Panel>
      <Modal
        open={createOpen}
        title="Create user account"
        onClose={() => !submitting && setCreateOpen(false)}
      >
        {userForm()}
      </Modal>
      <DetailDrawer
        open={Boolean(selected)}
        title={selected ? displayName(selected) : "Account details"}
        subtitle={selected?.email}
        eyebrow="Staff account"
        onClose={closeDrawer}
        dirty={dirty}
        onDiscard={() => setEditing(false)}
      >
        {selected &&
          (editing ? (
            <DrawerSection eyebrow="Edit account" title="Update identity">
              {userForm()}
            </DrawerSection>
          ) : (
            <>
              <DrawerSection>
                <div className="operational-drawer__identity">
                  <Avatar
                    initials={createInitials(displayName(selected))}
                    tone={selected.role === "administrator" ? "violet" : "blue"}
                    size="lg"
                  />
                  <div>
                    <strong>{roleLabel(selected.role)}</strong>
                    <span>{selected.isVerified ? "Verified identity" : "Needs verification"}</span>
                  </div>
                  <Badge tone={statusTone(accountStatus(selected))}>
                    {accountStatusLabel(accountStatus(selected))}
                  </Badge>
                </div>
              </DrawerSection>
              <DrawerSection eyebrow="Access facts" title="Account snapshot">
                <div className="operational-drawer__rows">
                  <div className="operational-drawer__row">
                    <span>Role</span>
                    <strong>{roleLabel(selected.role)}</strong>
                  </div>
                  <div className="operational-drawer__row">
                    <span>Verification</span>
                    <strong>{selected.isVerified ? "Verified" : "Unverified"}</strong>
                  </div>
                  <div className="operational-drawer__row">
                    <span>Blocked</span>
                    <strong>{selected.isBlocked ? "Blocked" : "Unblocked"}</strong>
                  </div>
                  <div className="operational-drawer__row">
                    <span>Joined</span>
                    <strong>{new Date(selected.createdAt).toLocaleString()}</strong>
                  </div>
                </div>
              </DrawerSection>
              {currentUserRole === "manager" && selected.canManageAccount !== true && (
                <p className="form-hint">This shared account requires Administrator management.</p>
              )}
              {(selectedCanEdit || selectedCanChangeLifecycle || selectedCanDeactivate) && (
                <DrawerSection eyebrow="Lifecycle" title="Manage access">
                  <div className="operational-drawer__actions">
                    {selectedCanEdit && (
                      <Button variant="secondary" icon="edit" onClick={() => openEdit(selected)}>
                        Edit account
                      </Button>
                    )}
                    {selectedCanChangeLifecycle &&
                      (selected.isVerified ? (
                        <Button
                          variant="secondary"
                          onClick={() => requestLifecycle(selected, "unverify")}
                        >
                          Unverify
                        </Button>
                      ) : (
                        <Button
                          variant="success"
                          onClick={() => requestLifecycle(selected, "verify")}
                        >
                          Verify account
                        </Button>
                      ))}
                    {selectedCanChangeLifecycle &&
                      (selected.isBlocked ? (
                        <Button
                          variant="success"
                          onClick={() => requestLifecycle(selected, "unblock")}
                        >
                          Unblock
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() => requestLifecycle(selected, "block")}
                        >
                          Block account
                        </Button>
                      ))}
                    {selectedCanDeactivate && (
                      <Button
                        variant="danger"
                        icon="trash"
                        onClick={() => setPendingDelete(selected)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                  {selectedCanChangeLifecycle && (
                    <p className="form-hint">
                      Blocking or unverifying revokes active sessions immediately.
                    </p>
                  )}
                </DrawerSection>
              )}
            </>
          ))}
      </DetailDrawer>
      <ConfirmDialog
        open={Boolean(pendingLifecycle)}
        title={
          pendingLifecycle?.action === "block" ? "Block this account?" : "Unverify this account?"
        }
        description={
          pendingLifecycle
            ? `${displayName(pendingLifecycle.user)} will be unable to sign in, and active sessions will be revoked.`
            : undefined
        }
        confirmLabel={pendingLifecycle?.action === "block" ? "Block account" : "Unverify account"}
        danger
        busy={busy}
        onClose={() => !busy && setPendingLifecycle(null)}
        onConfirm={() =>
          pendingLifecycle && void changeLifecycle(pendingLifecycle.user, pendingLifecycle.action)
        }
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Deactivate this account?"
        description={
          pendingDelete
            ? `${displayName(pendingDelete)} will be signed out and removed from active account lists.`
            : undefined
        }
        confirmLabel="Deactivate account"
        danger
        busy={busy}
        onClose={() => !busy && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteUser(pendingDelete)}
      />
    </div>
  );
}
