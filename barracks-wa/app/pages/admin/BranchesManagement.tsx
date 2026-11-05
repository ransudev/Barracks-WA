"use client";
import { SkeletonCards } from "@/app/components/ui/Skeletons";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, readApiBody, type ApiRole } from "@/app/lib/api";
import type { Branch, BranchAssignment, BranchStaff } from "@/app/types/branch";
import { roleLabel } from "@/app/constants/roles";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from "@/app/components/ui";

type BranchBody = {
  success: boolean;
  message?: string;
  branches?: Branch[];
  branch?: Branch;
  staff?: BranchStaff[];
  assignments?: BranchAssignment[];
};
type Draft = Pick<Branch, "name" | "code" | "address" | "phone" | "status">;
const blank: Draft = { name: "", code: "", address: "", phone: "", status: "active" };
async function branchRequest(path: string, init?: RequestInit): Promise<BranchBody> {
  const response = await apiRequest(path, { cache: "no-store", ...init });
  const body = await readApiBody<BranchBody>(response);
  if (!response.ok || !body?.success)
    throw new Error(body?.message ?? "Unable to process branch request");
  return body;
}

export function BranchesManagement({
  currentUserRole,
  onToast,
}: {
  currentUserRole: ApiRole;
  onToast: (message: string) => void;
}) {
  return currentUserRole === "administrator" ? (
    <AdministratorBranches onToast={onToast} />
  ) : (
    <div role="alert">You do not have access to this page</div>
  );
}

function AdministratorBranches({ onToast }: { onToast: (message: string) => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<BranchStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Branch | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [assignmentBranch, setAssignmentBranch] = useState<Branch | null>(null);

  useEffect(() => {
    let active = true;
    void branchRequest("/api/branches")
      .then((body) => {
        if (active) {
          setBranches(body.branches ?? []);
          setStaff(body.staff ?? []);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function replaceBranch(branch: Branch) {
    setBranches((current) =>
      [...current.filter((item) => item.id !== branch.id), branch].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  }
  function closeEditor() {
    if (!saving) {
      setAdding(false);
      setEditing(null);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const body = await branchRequest(editing ? `/api/branches/${editing.id}` : "/api/branches", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(draft),
      });
      if (!body.branch) throw new Error("Unable to save branch");
      replaceBranch(body.branch);
      setAdding(false);
      setEditing(null);
      onToast(`${body.branch.name} saved`);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Unable to save branch");
    } finally {
      setSaving(false);
    }
  }
  async function toggle(branch: Branch) {
    setSaving(true);
    try {
      const body = await branchRequest(`/api/branches/${branch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: branch.status === "active" ? "inactive" : "active" }),
      });
      if (!body.branch) throw new Error("Unable to update branch");
      replaceBranch(body.branch);
      onToast(
        `${body.branch.name} ${body.branch.status === "active" ? "activated" : "deactivated"}`,
      );
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Unable to update branch");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="branches-management">
      <PageHeader
        title="Branches"
        action={
          <Button
            icon="plus"
            disabled={saving || loading}
            onClick={() => {
              setDraft(blank);
              setFormError("");
              setAdding(true);
            }}
          >
            Add branch
          </Button>
        }
      />
      {loading ? (
        <SkeletonCards count={3} label="Loading branches" />
      ) : error ? (
        <div className="branch-notice" role="alert">
          {error}
        </div>
      ) : branches.length ? (
        <div className="branches-list">
          {branches.map((branch) => (
            <Panel key={branch.id} className="branch-card">
              <div className="branch-summary">
                <div>
                  <h2>{branch.name}</h2>
                  <p>{branch.code}</p>
                </div>
                <Badge tone={branch.status === "active" ? "success" : "warning"}>
                  {branch.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </div>
              <dl className="branch-details">
                <div>
                  <dt>Address</dt>
                  <dd>{branch.address || "No address provided"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{branch.phone || "No phone provided"}</dd>
                </div>
              </dl>
              <div className="branch-actions branch-card__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setEditing(branch);
                    setDraft({
                      name: branch.name,
                      code: branch.code,
                      address: branch.address,
                      phone: branch.phone,
                      status: branch.status,
                    });
                    setFormError("");
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void toggle(branch)}
                >
                  {branch.status === "active" ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => setAssignmentBranch(branch)}
                >
                  Manage staff
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No branches" description="Add a branch to get started." />
      )}
      <Modal
        open={adding || Boolean(editing)}
        title={editing ? "Edit branch" : "Add branch"}
        onClose={closeEditor}
      >
        <form className="modal-form" onSubmit={save}>
          {formError && <div role="alert">{formError}</div>}
          <TextField
            label="Branch name"
            required
            maxLength={160}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <TextField
            label="Branch code"
            required
            maxLength={40}
            pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
          <TextField
            label="Address"
            maxLength={500}
            value={draft.address}
            onChange={(event) => setDraft({ ...draft, address: event.target.value })}
          />
          <TextField
            label="Phone"
            type="tel"
            maxLength={40}
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
          <SelectField
            label="Status"
            value={draft.status}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as Draft["status"] })
            }
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </SelectField>
          <div className="modal-actions">
            <Button variant="secondary" type="button" disabled={saving} onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save branch"}
            </Button>
          </div>
        </form>
      </Modal>
      {assignmentBranch && (
        <AssignmentManager
          key={assignmentBranch.id}
          branch={assignmentBranch}
          staff={staff}
          onClose={() => setAssignmentBranch(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function AssignmentManager({
  branch,
  staff,
  onClose,
  onToast,
}: {
  branch: Branch;
  staff: BranchStaff[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [assignments, setAssignments] = useState<BranchAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const path = `/api/branches/${branch.id}/assignments`;
  useEffect(() => {
    let active = true;
    void branchRequest(path)
      .then((body) => {
        if (active) setAssignments(body.assignments ?? []);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function change(method: "POST" | "PATCH" | "DELETE", memberId: number) {
    setSaving(true);
    setError("");
    try {
      await branchRequest(method === "POST" ? path : `${path}/${memberId}`, {
        method,
        ...(method === "DELETE"
          ? {}
          : {
              body: JSON.stringify(
                method === "POST" ? { userId: memberId, isPrimary } : { isPrimary: true },
              ),
            }),
      });
      setAssignments((await branchRequest(path)).assignments ?? []);
      setUserId("");
      setIsPrimary(false);
      onToast("Staff assignments updated");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update assignment");
    } finally {
      setSaving(false);
    }
  }
  const available = staff.filter(
    (person) => !assignments.some((item) => item.userId === person.id),
  );
  return (
    <Modal
      open
      title={`Staff — ${branch.name}`}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="modal-form">
        {error && <div role="alert">{error}</div>}
        {loading ? (
          <div role="status">Loading assigned staff…</div>
        ) : assignments.length ? (
          <ul className="branch-members">
            {assignments.map((assignment) => (
              <li key={assignment.userId}>
                <div>
                  <strong>
                    {assignment.staff.firstName} {assignment.staff.lastName}
                  </strong>
                  <p>
                    {roleLabel(assignment.staff.role)}
                    {assignment.isPrimary ? " · Primary branch" : ""}
                  </p>
                </div>
                <div className="branch-actions">
                  {!assignment.isPrimary && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={saving}
                      onClick={() => void change("PATCH", assignment.userId)}
                    >
                      Set primary
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void change("DELETE", assignment.userId)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No assigned Managers or Front Desk.</p>
        )}
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (userId) void change("POST", Number(userId));
          }}
        >
          <SelectField
            label="Staff account"
            required
            disabled={loading || saving}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Choose staff</option>
            {available.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName} — {roleLabel(person.role)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Make this their primary branch"
            disabled={loading || saving}
            value={isPrimary ? "yes" : "no"}
            onChange={(event) => setIsPrimary(event.target.value === "yes")}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </SelectField>
          <p>
            Setting primary replaces their previous primary. Removing a primary assignment leaves no
            primary branch.
          </p>
          <div className="modal-actions">
            <Button type="submit" disabled={loading || saving || !userId}>
              {saving ? "Saving…" : "Assign staff"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
