"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/app/components/ui";
import { apiRequest, errorMessage, readApiBody, type ApiInventoryItem } from "@/app/lib/api";
import { movementLabel, type Movement } from "./model";

export function HistoryDialog({
  item,
  branchId,
  onToast,
  onClose,
}: {
  item: ApiInventoryItem;
  branchId: number;
  onToast: (message: string) => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiRequest(
          `/api/inventory/${item.id}/movements?branchId=${branchId}`,
          { cache: "no-store" },
        );
        const body = await readApiBody<{
          success: boolean;
          movements?: Movement[];
          message?: string;
        }>(response);
        if (!active) return;
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Unable to load movement history");
        setHistory(body.movements ?? []);
      } catch (error) {
        if (active) onToast(errorMessage(error, "Unable to load movement history"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [item.id, branchId, onToast]);

  return (
    <Modal open title={`${item.name} movement history`} onClose={onClose}>
      {loading ? (
        <p className="inventory-modal-loading">Loading history…</p>
      ) : history.length ? (
        <div className="staff-table staff-table--cols-4 inventory-history-table">
          {history.map((movement) => (
            <div className="staff-table__row" key={movement.id}>
              <span>
                <strong>{movementLabel(movement.movement_type)}</strong>
                <small>
                  {new Date(movement.created_at).toLocaleString()} · {movement.created_by_name} ·{" "}
                  {movement.branch}
                </small>
              </span>
              <span>
                {movement.previous_stock} → {movement.new_stock}
              </span>
              <span>{movement.reference ?? "No reference"}</span>
              <span>{movement.notes || "No notes"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="inventory-modal-loading">No stock movements have been recorded yet.</p>
      )}
    </Modal>
  );
}
