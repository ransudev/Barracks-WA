"use client";

import { ReportBranchScope } from "@/app/components/ReportBranchScope";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, PageHeader, Panel, TextField } from "@/app/components/ui";
import { InventoryReports } from "@/app/pages/admin/InventoryReports";
import { RevenueReports } from "@/app/pages/admin/RevenueReports";
import { displayDate, presetRange, type ReportPreset, type ReportRange } from "./report-utils";
import styles from "./reports.module.css";

const presets: ReportPreset[] = ["Today", "This week", "This month", "Last 30 days"];

export function ManagementReports({
  onToast,
  globalAllowed = false,
}: {
  onToast: (message: string) => void;
  globalAllowed?: boolean;
}) {
  return (
    <ReportBranchScope globalAllowed={globalAllowed}>
      {(branch, branchControl) => (
        <ManagementReportsContent branch={branch} branchControl={branchControl} onToast={onToast} />
      )}
    </ReportBranchScope>
  );
}
function ManagementReportsContent({
  onToast,
  branch,
  branchControl,
}: {
  onToast: (message: string) => void;
  branch: string;
  branchControl: ReactNode;
}) {
  const [section, setSection] = useState<"sales" | "inventory">("sales");
  const [range, setRange] = useState<ReportRange>(() => presetRange("Last 30 days"));
  const [draft, setDraft] = useState(range);
  const [preset, setPreset] = useState<ReportPreset | null>("Last 30 days");

  function applyRange(event: FormEvent) {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to) {
      onToast("Choose a valid report date range");
      return;
    }
    setRange({ ...draft });
    setPreset(null);
  }

  function selectPreset(value: ReportPreset) {
    const selected = presetRange(value);
    setRange(selected);
    setDraft(selected);
    setPreset(value);
  }

  return (
    <div className={styles.dashboard}>
      <PageHeader title="Reports" action={branchControl} />
      <div className={styles.tabs} role="group" aria-label="Report type">
        <Button
          type="button"
          aria-pressed={section === "sales"}
          variant="ghost"
          onClick={() => setSection("sales")}
        >
          Sales & revenue
        </Button>
        <Button
          type="button"
          aria-pressed={section === "inventory"}
          variant="ghost"
          onClick={() => setSection("inventory")}
        >
          Inventory
        </Button>
      </div>
      <Panel className={styles.period}>
        <div className={styles.presets} role="group" aria-label="Report period presets">
          {presets.map((value) => (
            <Button
              key={value}
              size="sm"
              type="button"
              aria-pressed={preset === value}
              variant="ghost"
              onClick={() => selectPreset(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <form className={styles.dateForm} onSubmit={applyRange}>
          <TextField
            label="From"
            type="date"
            required
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
          <TextField
            label="To"
            type="date"
            required
            min={draft.from}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
          <Button type="submit" variant="secondary">
            Apply period
          </Button>
        </form>
        <p className={styles.note}>
          Showing {displayDate(range.from, { dateStyle: "medium" })} –{" "}
          {displayDate(range.to, { dateStyle: "medium" })} · Manila time
        </p>
      </Panel>
      {section === "sales" ? (
        <RevenueReports
          key={`${range.from}:${range.to}`}
          range={range}
          branch={branch}
          onToast={onToast}
        />
      ) : (
        <InventoryReports range={range} branch={branch} onToast={onToast} />
      )}
    </div>
  );
}
