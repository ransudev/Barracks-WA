"use client";

import type { ReactNode } from "react";
import { Button, EmptyState, Panel, SectionHeading } from "@/app/components/ui";
import styles from "./reports.module.css";

export function ReportStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  if (error)
    return (
      <Panel className={styles.status}>
        <p role="alert">{error}</p>
        <Button type="button" variant="secondary" onClick={retry}>
          Retry report
        </Button>
      </Panel>
    );
  if (loading)
    return (
      <Panel className={styles.status}>
        <p role="status">Loading your report…</p>
        <div className={styles.skeleton} aria-hidden="true" />
      </Panel>
    );
  return null;
}

export function ReportDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={styles.details}>
      <summary>
        {title}
        <span>View data</span>
      </summary>
      <div className={styles.tableScroll}>{children}</div>
    </details>
  );
}

export type BarRow = { id?: string | number; label: string; value: number; detail?: string };

export function RankedBars({
  title,
  description,
  rows,
  format,
  children,
  matchSibling = false,
}: {
  title: string;
  description?: string;
  rows: BarRow[];
  format: (value: number) => string;
  children?: ReactNode;
  matchSibling?: boolean;
}) {
  const ranked = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const hasNegative = rows.some((row) => row.value < 0);
  const content = (
    <>
      {ranked.length ? (
        <ol className={styles.rankList}>
          {ranked.slice(0, 7).map((row) => (
            <li key={row.id ?? row.label}>
              <div className={styles.rankLabel}>
                <strong>{row.label}</strong>
                <strong>{format(row.value)}</strong>
              </div>
              <div
                className={`${styles.barTrack} ${hasNegative ? styles.diverging : ""}`}
                aria-hidden="true"
              >
                <span
                  className={row.value < 0 ? styles.negativeBar : styles.positiveBar}
                  style={{
                    width: `${(Math.abs(row.value) / max) * (hasNegative ? 50 : 100)}%`,
                    ...(hasNegative
                      ? {
                          left: row.value < 0 ? `${50 - (Math.abs(row.value) / max) * 50}%` : "50%",
                        }
                      : {}),
                  }}
                />
              </div>
              {row.detail && <small>{row.detail}</small>}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No activity in this period"
          description="Try another date range to see this breakdown."
        />
      )}
      {ranked.length > 7 && (
        <p className={styles.note}>
          Showing the top 7 of {ranked.length}. All groups are in the breakdown.
        </p>
      )}
      {children}
    </>
  );
  return (
    <Panel className={`${styles.visualPanel} ${matchSibling ? styles.matchedPanel : ""}`}>
      <SectionHeading title={title} description={description} />
      {matchSibling ? (
        <div
          className={styles.scrollBody}
          role="region"
          aria-label={`${title} details`}
          tabIndex={0}
        >
          {content}
        </div>
      ) : (
        content
      )}
    </Panel>
  );
}
