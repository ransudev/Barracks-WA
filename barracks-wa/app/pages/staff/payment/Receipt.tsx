"use client";

import { createPortal } from "react-dom";
import { Button } from "@/app/components/ui";
import { landingContact } from "@/app/data/landing";
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

const statusText: Record<string, string> = {
  completed: "PAID",
  voided: "VOIDED",
  refunded: "REFUNDED",
};

// Laid out for 58 mm thermal paper, the narrowest common receipt roll.
function ReceiptPaper({ transaction }: { transaction: TransactionRecord }) {
  // Every service paid together shares this receipt.
  const lines = transaction.lines?.length
    ? transaction.lines
    : [
        {
          reference: transaction.reference,
          serviceName: transaction.serviceName,
          barberName: transaction.barberName,
          amount: transaction.total,
          status: transaction.status,
          priorPaid: transaction.priorPaid,
        },
      ];
  const live = lines.filter((line) => line.status === "completed");
  const total = (live.length ? live : lines).reduce((sum, line) => sum + line.amount, 0);
  const priorPaid = (live.length ? live : lines).reduce((sum, line) => sum + line.priorPaid, 0);
  const cash = transaction.lines ? transaction.receiptTendered : transaction.tendered;
  const change = transaction.lines ? transaction.receiptChange : transaction.change;
  const business = transaction.business;
  const phone = business?.phone || landingContact.localPhone;
  return (
    <div className="receipt-paper">
      <header className="receipt-head">
        <h2>BARRACKS</h2>
        <p>{business?.name ?? "Barbershop"}</p>
        {business?.address && <p>{business.address}</p>}
        <p>Tel: {phone}</p>
        <p>TIN: {business?.tin || "—"}</p>
      </header>
      <p className="receipt-title">PAYMENT RECEIPT</p>
      <dl className="receipt-meta">
        <dt>Ref</dt>
        <dd>{transaction.receiptGroup ?? transaction.reference}</dd>
        <dt>Date</dt>
        <dd>
          {new Date(transaction.createdAt).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </dd>
        <dt>Customer</dt>
        <dd>{transaction.customerName}</dd>
        <dt>Cashier</dt>
        <dd>{transaction.cashierName ?? "—"}</dd>
      </dl>
      <table className="receipt-lines">
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.reference} className={line.status === "completed" ? "" : "is-reversed"}>
              <td>
                {line.serviceName}
                <small>
                  {line.barberName}
                  {line.status === "completed" ? "" : ` · ${statusText[line.status] ?? line.status}`}
                </small>
              </td>
              <td>{money(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="receipt-totals">
        {transaction.balanceVoid && (
          <>
            <dt>Regular price</dt>
            <dd>{money(transaction.balanceVoid.originalAmount)}</dd>
            <dt>Balance voided</dt>
            <dd>− {money(transaction.balanceVoid.voidedAmount)}</dd>
          </>
        )}
        <dt className="receipt-total">TOTAL</dt>
        <dd className="receipt-total">{money(total)}</dd>
        {priorPaid > 0 && (
          <>
            <dt>Deposit / paid earlier</dt>
            <dd>{money(priorPaid)}</dd>
            <dt>Paid now</dt>
            <dd>{money(Math.max(0, total - priorPaid))}</dd>
          </>
        )}
        <dt>Method</dt>
        <dd>{methodLabel(transaction.paymentMethod)}</dd>
        {transaction.paymentMethod === "cash" && (
          <>
            <dt>Cash</dt>
            <dd>{cash === null || cash === undefined ? "—" : money(cash)}</dd>
            <dt>Change</dt>
            <dd>{change === null || change === undefined ? "—" : money(change)}</dd>
          </>
        )}
        <dt>Status</dt>
        <dd>
          {live.length === lines.length
            ? "PAID"
            : live.length
              ? "PARTLY VOIDED"
              : (statusText[transaction.status] ?? transaction.status)}
        </dd>
      </dl>
      {transaction.balanceVoid && (
        <p className="receipt-note">
          Void reason: {transaction.balanceVoid.reason} ({transaction.balanceVoid.staffName})
        </p>
      )}
      {transaction.actions?.map((action) => (
        <p key={action.id} className="receipt-note">
          {action.action === "refund" ? "Refund" : "Void"} {money(action.amount)} · {action.reason}{" "}
          · {action.staffName} ·{" "}
          {new Date(action.createdAt).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      ))}
      <p className="receipt-foot">Thank you. See you at the Barracks.</p>
    </div>
  );
}
