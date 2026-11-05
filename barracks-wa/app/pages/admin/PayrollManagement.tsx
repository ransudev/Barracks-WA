"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";

import { useEffect, useState } from "react";
import { errorMessage, type ApiRole } from "@/app/lib/api";
import { useBranchContext } from "@/app/utils/use-branch-context";
import { Button, EmptyState, PageHeader, Panel } from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import type { PayrollDetail, PayrollOverview } from "@/app/types/payroll";
import "./payroll.css";
import { PayrollEditorDialog } from "./payroll/PayrollEditorDialog";
import { PayrollRecordDetail } from "./payroll/PayrollRecordDetail";
import { PayrollRecordsView, type PayrollFilters } from "./payroll/PayrollRecordsView";
import { PayrollSettings } from "./payroll/PayrollSettings";
import { payrollRequest, type Editor } from "./payroll/shared";

export function PayrollManagement({
  currentUserRole,
  onToast,
}: {
  currentUserRole: ApiRole;
  onToast: (message: string) => void;
}) {
  if (currentUserRole !== "administrator" && currentUserRole !== "manager")
    return <p role="alert">You do not have access to payroll.</p>;
  return <PayrollBranches currentUserRole={currentUserRole} onToast={onToast} />;
}
function PayrollBranches(props: { currentUserRole: ApiRole; onToast: (message: string) => void }) {
  const context = useBranchContext();
  return <BranchPayroll key={context.branchId} {...props} context={context} />;
}
function BranchPayroll({
  currentUserRole,
  onToast,
  context,
}: {
  currentUserRole: ApiRole;
  onToast: (message: string) => void;
  context: ReturnType<typeof useBranchContext>;
}) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = context;
  const [tab, setTab] = useState<"overview" | "settings" | "history">("overview");
  const [overview, setOverview] = useState<PayrollOverview | null>(null);
  const [filters, setFilters] = useState<PayrollFilters>({
    period: "",
    search: "",
    status: "",
    barberFilter: "",
  });
  const { period, search, status, barberFilter } = filters;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(branchId));
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController();
    const filters = new URLSearchParams({ branchId: String(branchId) });
    if (selected) filters.set("recordId", selected);
    else {
      if (period) filters.set("periodStart", period);
      if (search) filters.set("search", search);
      if (status) filters.set("status", status);
      if (barberFilter) filters.set("barberId", barberFilter);
      filters.set("page", String(page));
    }
    const frame = window.requestAnimationFrame(() => {
      setLoading(true);
      setError("");
      setDetail(null);
      void payrollRequest<PayrollOverview | PayrollDetail>(
        `?${filters}`,
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          if ("record" in data) setDetail(data);
          else setOverview(data);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(errorMessage(cause, "Unable to load payroll"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [branchId, period, search, status, barberFilter, page, selected, revision]);
  function updateFilters(patch: Partial<PayrollFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }
  return (
    <div className="payroll-workspace operational-workspace">
      <PageHeader
        title="Payroll"
        action={
          <BranchSwitcher
            branches={branches}
            value={branchId}
            loading={branchLoading}
            disabled={Boolean(editor)}
            onChange={setBranchId}
          />
        }
      />
      <div className="payroll-toolbar">
        <nav className="task-view-switch payroll-tabs" aria-label="Payroll sections">
          {(["overview", "history", "settings"] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={item === tab}
              aria-current={item === tab ? "page" : undefined}
              disabled={Boolean(editor)}
              onClick={() => {
                setTab(item);
                setSelected(null);
                setPage(1);
              }}
            >
              {item === "settings"
                ? "Commission settings"
                : item === "history"
                  ? "History"
                  : "Overview"}
            </button>
          ))}
        </nav>
        {overview?.settings && !detail && tab !== "settings" && (
          <Button icon="plus" onClick={() => setEditor({ kind: "generate" })}>
            Generate draft
          </Button>
        )}
      </div>
      {(branchError || error) && (
        <p className="form-error" role="alert">
          {branchError || error}{" "}
          <Button variant="ghost" onClick={() => setRevision((r) => r + 1)}>
            Retry
          </Button>
        </p>
      )}
      {loading && overview && !selected && <p role="status">Updating payroll…</p>}
      {(loading && (!overview || selected)) || branchLoading ? (
        <SkeletonRows count={6} label="Loading payroll" />
      ) : !branchId ? (
        <Panel>
          <EmptyState title="Select a branch" />
        </Panel>
      ) : detail ? (
        <PayrollRecordDetail
          detail={detail}
          currentUserRole={currentUserRole}
          onBack={() => setSelected(null)}
          onEdit={setEditor}
        />
      ) : overview && tab === "settings" ? (
        <PayrollSettings overview={overview} currentUserRole={currentUserRole} onEdit={setEditor} />
      ) : overview && tab !== "settings" ? (
        <PayrollRecordsView
          overview={overview}
          tab={tab}
          filters={filters}
          page={page}
          onFiltersChange={updateFilters}
          onPageChange={setPage}
          onOpenSettings={() => setTab("settings")}
          onReview={setSelected}
        />
      ) : null}
      {editor && (
        <PayrollEditorDialog
          editor={editor}
          branchId={branchId}
          period={period}
          anchorDate={overview?.settings?.anchor_date}
          onClose={() => setEditor(null)}
          onSaved={(result) => {
            if (editor.kind === "supplement" && result.recordId) setSelected(result.recordId);
            setEditor(null);
            setRevision((current) => current + 1);
            onToast(result.message);
          }}
        />
      )}
    </div>
  );
}
