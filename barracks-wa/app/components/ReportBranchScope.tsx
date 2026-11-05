"use client";
import { Fragment, useState, type ReactNode } from "react";
import { SelectField } from "@/app/components/ui";
import { DashboardSkeleton } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";

// Children receive the selected scope and a compact branch picker to place in
// their page header.
export function ReportBranchScope({
  globalAllowed = false,
  children,
}: {
  globalAllowed?: boolean;
  children: (branch: string, branchControl: ReactNode) => ReactNode;
}) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = useBranchContext();
  const [global, setGlobal] = useState(globalAllowed);
  const selected = globalAllowed && global ? "all" : String(branchId);
  const ready = (globalAllowed && global) || (!branchLoading && branchId > 0);
  const control = (
    <SelectField
      className="branch-switcher"
      label="Branch"
      value={ready ? selected : ""}
      onChange={(event) => {
        const value = event.target.value;
        setGlobal(value === "all");
        if (value !== "all") setBranchId(Number(value));
      }}
    >
      {!ready && (
        <option value="">
          {branchError
            ? "Branches unavailable"
            : branchLoading
              ? "Loading branches…"
              : "No assigned branches"}
        </option>
      )}
      {globalAllowed && <option value="all">All branches</option>}
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name}
        </option>
      ))}
    </SelectField>
  );
  if (!ready && branchLoading && !branchError) return <DashboardSkeleton />;
  if (!ready)
    return (
      <div className="operational-workspace">
        <div className="page-header__actions">{control}</div>
        {branchError && <p role="alert">{branchError}</p>}
      </div>
    );
  return (
    <>
      <p className="visually-hidden" role="status">
        {selected === "all"
          ? "Global view · All branches"
          : `Branch view · ${branches.find((branch) => String(branch.id) === selected)?.name ?? ""}`}
      </p>
      <Fragment key={selected}>{children(selected, control)}</Fragment>
    </>
  );
}
