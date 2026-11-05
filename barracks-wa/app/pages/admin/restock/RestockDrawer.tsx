"use client";

import { Badge, Button } from "@/app/components/ui";
import { DetailDrawer, DrawerSection } from "@/app/components/operations/OperationalPrimitives";
import { statusTone, type Restock } from "./model";

export function RestockDrawer({
  selected,
  markingDelivered,
  cancelling,
  onClose,
  onConfirmArrival: setPendingDelivery,
  onReceive: openReceive,
  onCancel: setPendingCancel,
}: {
  selected: Restock | null;
  markingDelivered: number | null;
  cancelling: boolean;
  onClose: () => void;
  onConfirmArrival: (restock: Restock) => void;
  onReceive: (restock: Restock) => void;
  onCancel: (restock: Restock) => void;
}) {
  return (
    <DetailDrawer
      open={Boolean(selected)}
      title={selected ? `Restock request #${selected.id}` : "Restock request"}
      subtitle={selected ? `${selected.supplier_name} · ${selected.branch}` : undefined}
      eyebrow="Supply workflow"
      onClose={onClose}
    >
      {selected && (
        <>
          <DrawerSection>
            <div className="operational-drawer__identity">
              <span className="supplier-card-mark supplier-card-mark--large">
                <span>#{selected.id}</span>
              </span>
              <div>
                <strong>{selected.supplier_name}</strong>
                <span>{selected.reference || "No reference"}</span>
              </div>
              <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
            </div>
          </DrawerSection>
          <DrawerSection eyebrow="Request lines" title="Inventory requested">
            <div className="drawer-mini-list">
              {selected.items.map((item) => (
                <div key={item.id}>
                  <strong>{item.itemName}</strong>
                  <span>
                    {item.requestedQuantity} requested · {item.deliveredQuantity ?? "Not recorded"}{" "}
                    delivered
                  </span>
                </div>
              ))}
            </div>
          </DrawerSection>
          <DrawerSection title="Request notes">
            <p>{selected.notes || "No notes"}</p>
          </DrawerSection>
          <DrawerSection eyebrow="Actions" title="Move this request forward">
            <div className="operational-drawer__actions">
              {["Pending", "Accepted", "Preparing", "Shipped"].includes(selected.status) && (
                <Button
                  variant="secondary"
                  disabled={markingDelivered === selected.id}
                  onClick={() => setPendingDelivery(selected)}
                >
                  {markingDelivered === selected.id ? "Confirming…" : "Confirm arrival"}
                </Button>
              )}
              {selected.status === "Delivered" && (
                <Button icon="box" onClick={() => openReceive(selected)}>
                  Receive delivery
                </Button>
              )}
              {!["Received", "Cancelled"].includes(selected.status) && (
                <Button
                  variant="danger"
                  disabled={cancelling}
                  onClick={() => setPendingCancel(selected)}
                >
                  Cancel request
                </Button>
              )}
            </div>
            <ol className="restock-steps" aria-label="Restock steps">
              {["Request sent", "Supplier preparing", "Arrived at branch", "Stock received"].map(
                (step, index) => {
                  const reached =
                    selected.status === "Cancelled"
                      ? -1
                      : selected.status === "Received"
                        ? 3
                        : selected.status === "Delivered"
                          ? 2
                          : ["Accepted", "Preparing", "Shipped"].includes(selected.status)
                            ? 1
                            : 0;
                  return (
                    <li key={step} className={index <= reached ? "is-done" : ""}>
                      {step}
                    </li>
                  );
                },
              )}
            </ol>
            <p className="form-hint">
              {selected.status === "Delivered"
                ? "Count what arrived and record it with Receive delivery. That adds the stock to inventory."
                : ["Received", "Cancelled"].includes(selected.status)
                  ? "This request is closed and kept for history."
                  : "Suppliers with a portal login update progress themselves. If the goods have already arrived, confirm arrival here, then receive the delivery."}
            </p>
          </DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}
