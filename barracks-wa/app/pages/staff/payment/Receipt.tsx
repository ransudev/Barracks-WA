"use client";

import { createPortal } from "react-dom";
import { Button } from "@/app/components/ui";
import { methodLabel, money } from "./labels";
import type { TransactionRecord } from "@/server/services/payment.service";

export function Receipt({
  transaction,
  onClose,
}: {
  transaction: TransactionRecord;
  onClose: () => void;
}) {
  const paper = <ReceiptPaper transaction={transaction} />;
  return (
    <section className="receipt-view" aria-label="Receipt">
      <div className="receipt-actions">
        <Button type="button" onClick={() => window.print()}>
          Print Receipt
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close receipt
        </Button>
      </div>
      {paper}
      {/* Printing uses a body-level copy so the rest of the app takes no space on paper. */}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="receipt-print-root" aria-hidden="true">
            {paper}
          </div>,
          document.body,
        )}
    </section>
  );
}

function ReceiptPaper({ transaction }: { transaction: TransactionRecord }) {
  return (
    <div className="receipt-paper">
      <h2>Barracks</h2>
      <p>Payment receipt</p>
      <dl>
        <dt>Reference</dt>
        <dd>{transaction.reference}</dd>
        <dt>Date/time</dt>
        <dd>
          {new Date(transaction.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
        </dd>
        <dt>Customer</dt>
        <dd>{transaction.customerName}</dd>
        <dt>Service</dt>
        <dd>{transaction.serviceName}</dd>
        <dt>Barber</dt>
        <dd>{transaction.barberName}</dd>
        <dt>Cashier</dt>
        <dd>{transaction.cashierName ?? "—"}</dd>
        <dt>Subtotal</dt>
        <dd>{money(transaction.subtotal)}</dd>
        <dt>Total</dt>
        <dd>{money(transaction.total)}</dd>
        <dt>Payment method</dt>
        <dd>{methodLabel(transaction.paymentMethod)}</dd>
        {transaction.paymentMethod === "cash" && (
          <>
            <dt>Amount received</dt>
            <dd>{transaction.amountReceived === null ? "—" : money(transaction.amountReceived)}</dd>
            <dt>Change</dt>
            <dd>{transaction.change === null ? "—" : money(transaction.change)}</dd>
          </>
        )}
        <dt>Payment status</dt>
        <dd>{transaction.paymentStatus}</dd>
        {transaction.actions?.map((action) => (
          <div key={action.id} className="receipt-audit-entry">
            <dt>{action.action === "refund" ? "Refund" : "Void"}</dt>
            <dd>
              {money(action.amount)} · {action.reason} · {action.staffName} ·{" "}
              {new Date(action.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
