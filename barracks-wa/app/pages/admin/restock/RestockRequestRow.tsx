"use client";

import { Badge, Button } from "@/app/components/ui";
import { statusTone, type Restock } from "./model";

export function RestockRequestRow({
  restock,
  actionsDisabled,
  confirmDisabled,
  onOpen,
  onReceive,
  onConfirmArrival,
}: {
  restock: Restock;
  actionsDisabled: boolean;
  confirmDisabled: boolean;
  onOpen: () => void;
  onReceive: () => void;
  onConfirmArrival: () => void;
}) {
  return (
    <article className="restock-request-row">
      <button
        type="button"
        className="restock-request-row__detail"
        onClick={onOpen}
        aria-label={`Open restock request ${restock.id}`}
      >
        <span className="restock-request-identity">
          <small>Request #{restock.id}</small>
          <strong>{restock.supplier_name}</strong>
          <small>{restock.reference || "No reference"}</small>
        </span>
        <span className="restock-request-destination">
          <small className="restock-mobile-label">Branch</small>
          <strong>{restock.branch}</strong>
          <small>
            {new Date(restock.created_at).toLocaleDateString("en-PH", {
              timeZone: "Asia/Manila",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </small>
        </span>
        <span className="restock-request-items">
          <small className="restock-mobile-label">Requested items</small>
          {restock.items.map((item) => (
            <span key={item.id}>
              {item.itemName} <strong>× {item.requestedQuantity}</strong>
            </span>
          ))}
        </span>
        <span className="restock-request-status">
          <Badge tone={statusTone(restock.status)}>{restock.status}</Badge>
        </span>
      </button>
      <div className="restock-request-row__action">
        {restock.status === "Delivered" ? (
          <Button size="sm" disabled={actionsDisabled} onClick={onReceive}>
            Receive delivery
          </Button>
        ) : ["Pending", "Accepted", "Preparing", "Shipped"].includes(restock.status) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={confirmDisabled}
            onClick={onConfirmArrival}
          >
            Confirm arrival
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            View request
          </Button>
        )}
      </div>
    </article>
  );
}
