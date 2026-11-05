"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, Panel } from "@/app/components/ui";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { FilterToolbar, ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import { apiRequest, errorMessage, readApiBody, type ApiQueueEntry } from "@/app/lib/api";
import { manilaTime, matchesSearch, visitLabel } from "./model";

export function CompletedTodayPanel({
  branchId,
  search,
  onSearchChange,
}: {
  branchId: number;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const [completed, setCompleted] = useState<ApiQueueEntry[]>([]);
  const [completedLoading, setCompletedLoading] = useState(true);
  const [completedError, setCompletedError] = useState("");
  const visible = completed.filter((entry) => matchesSearch(entry, search));

  useEffect(() => {
    let active = true;
    async function loadCompleted() {
      try {
        const response = await apiRequest(`/api/queue?view=completed-today&branchId=${branchId}`, {
          cache: "no-store",
        });
        const body = await readApiBody<{
          success: boolean;
          queue?: ApiQueueEntry[];
          message?: string;
        }>(response);
        if (!response.ok || !body?.success || !body.queue)
          throw new Error(body?.message ?? "Unable to load completed queue");
        if (active) setCompleted(body.queue);
      } catch (cause) {
        if (active) setCompletedError(errorMessage(cause, "Unable to load completed queue"));
      } finally {
        if (active) setCompletedLoading(false);
      }
    }
    void loadCompleted();
    return () => {
      active = false;
    };
  }, [branchId]);

  return (
    <Panel className="operational-panel">
      <div className="inventory-catalog-head">
        <div>
          <span className="inventory-kicker">Today in Manila</span>
          <h2>Completed Today</h2>
          <p>Finished services are read-only.</p>
        </div>
      </div>
      <FilterToolbar
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search completed services"
        resultCount={visible.length}
      />
      {completedLoading ? (
        <SkeletonRows count={3} label="Loading completed services" />
      ) : completedError ? (
        <p role="alert">{completedError}</p>
      ) : !visible.length ? (
        <EmptyState
          icon="queue"
          title="No completed services today"
          description="Finished services will appear here."
        />
      ) : (
        <ResponsiveTable
          headers={["Customer", "Service", "Barber", "Type", "Started", "Completed"]}
        >
          {visible.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.customerName}</td>
              <td>{entry.serviceName}</td>
              <td>{entry.barberName ?? "Unassigned"}</td>
              <td>
                <Badge tone={entry.visitType === "appointment" ? "info" : "neutral"}>
                  {visitLabel(entry)}
                </Badge>
              </td>
              <td>{manilaTime(entry.startedAt)}</td>
              <td>{manilaTime(entry.completedAt)}</td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
    </Panel>
  );
}
