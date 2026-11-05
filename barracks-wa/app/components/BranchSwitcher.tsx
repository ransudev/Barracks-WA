"use client";
import { SelectField } from "@/app/components/ui";
import type { Branch } from "@/app/types/branch";

// Compact branch picker that lives in a page header's action row.
export function BranchSwitcher({
  branches,
  value,
  onChange,
  disabled = false,
  loading = false,
}: {
  branches: Pick<Branch, "id" | "name">[];
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <SelectField
      className="branch-switcher"
      label="Branch"
      value={value || ""}
      disabled={disabled || !branches.length}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {!value && (
        <option value="">
          {loading ? "Loading…" : branches.length ? "Select branch" : "No branch assigned"}
        </option>
      )}
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name}
        </option>
      ))}
    </SelectField>
  );
}
