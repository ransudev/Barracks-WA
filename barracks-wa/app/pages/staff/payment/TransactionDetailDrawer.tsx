"use client";

import { useState } from "react";
import { Button, ConfirmDialog, SectionHeading, TextField } from "@/app/components/ui";
import { DetailDrawer } from "@/app/components/operations/OperationalPrimitives";
import { money } from "./labels";
import { Receipt } from "./Receipt";
import type { useTransactionDetail } from "./useTransactionDetail";

export function TransactionDetailDrawer({
  detail: {
    detailOpen,
    receipt,
    receiptError,
    receiptLoading,
    actionReason,
    setActionReason,
    actionError,
    actionProcessing,
    applyAction,
    close,
  },
  canManageFinancialActions,
}: {
  detail: ReturnType<typeof useTransactionDetail>;
  canManageFinancialActions: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<"refund" | "void" | null>(null);
  return (
    <>
      <DetailDrawer
        open={detailOpen}
        title="Transaction details"
        subtitle={receipt?.reference}
        onClose={close}
      >
        {receiptLoading && <p role="status">Loading transaction…</p>}
        {receiptError && <p role="alert">{receiptError}</p>}
        {receipt && (
          <>
            <Receipt transaction={receipt} onClose={close} />
            {canManageFinancialActions && receipt.status === "completed" && (
              <section className="financial-action-panel">
                <SectionHeading title="Refund or void transaction" />
                <p>
                  Full amount: {money(receipt.total)}. A reason is required and the original receipt
                  is retained.
                </p>
                <TextField
                  label="Reason"
                  value={actionReason}
                  disabled={actionProcessing}
                  maxLength={500}
                  onChange={(event) => setActionReason(event.target.value)}
                />
                {actionError && <p role="alert">{actionError}</p>}
                <div className="financial-action-buttons">
                  <Button
                    type="button"
                    disabled={actionProcessing || !actionReason.trim()}
                    onClick={() => setPendingAction("refund")}
                  >
                    Refund full amount
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={actionProcessing || !actionReason.trim()}
                    onClick={() => setPendingAction("void")}
                  >
                    Void transaction
                  </Button>
                </div>
              </section>
            )}
            {canManageFinancialActions && (
              <section className="financial-audit-panel">
                <SectionHeading title="Financial audit history" />
                {!receipt.actions?.length && <p>No refund or void actions recorded.</p>}
                {receipt.actions?.map((action) => (
                  <p key={action.id}>
                    {action.action} · {money(action.amount)} · {action.reason} · {action.staffName}{" "}
                    ·{" "}
                    {new Date(action.createdAt).toLocaleString("en-PH", {
                      timeZone: "Asia/Manila",
                    })}
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </DetailDrawer>
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction === "refund" ? "Refund this transaction?" : "Void this transaction?"}
        description={
          receipt ? `${receipt.reference} · ${money(receipt.total)} · ${actionReason}` : undefined
        }
        confirmLabel="Confirm action"
        danger
        busy={actionProcessing}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) void applyAction(action);
        }}
      />
    </>
  );
}
