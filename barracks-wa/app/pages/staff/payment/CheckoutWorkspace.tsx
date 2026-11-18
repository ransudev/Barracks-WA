"use client";

import { useRef, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  Panel,
  SectionHeading,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { FilterToolbar } from "@/app/components/operations/OperationalPrimitives";
import { apiRequest, errorMessage, readApiBody } from "@/app/lib/api";
import type { PaymentMethod } from "@/server/schemas/payment.schema";
import type { EligibleVisit, TransactionRecord } from "@/server/services/payment.service";
import { methodLabel, methods, money } from "./labels";

const visitKey = (visit: EligibleVisit) => `${visit.visitType}:${visit.visitRecordId}`;
const visitRef = (visit: EligibleVisit) =>
  visit.visitType === "booking"
    ? { bookingId: visit.visitRecordId }
    : { queueEntryId: visit.visitRecordId };
const cents = (amount: number) => Math.round(amount * 100);

export function CheckoutWorkspace({
  visits,
  loading,
  loadError,
  canVoid,
  onToast,
  onVisitSelected,
  onCompleted,
  onReload,
}: {
  visits: EligibleVisit[];
  loading: boolean;
  loadError: string;
  // Managers may void the unpaid balance of a visit.
  canVoid: boolean;
  onToast: (message: string) => void;
  onVisitSelected: () => void;
  onCompleted: (transaction: TransactionRecord) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [visitSearch, setVisitSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountText, setAmountText] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const submitting = useRef(false);
  const matching = visits.filter((visit) =>
    `${visit.customerName} ${visit.serviceName} ${visit.barberName} ${visit.visitRecordId}`
      .toLowerCase()
      .includes(visitSearch.trim().toLowerCase()),
  );
  const selected = visits.filter((visit) => selectedKeys.includes(visitKey(visit)));
  const first = selected[0];
  const total = selected.reduce((sum, visit) => sum + cents(visit.total), 0) / 100;
  const alreadyPaid = selected.reduce((sum, visit) => sum + cents(visit.paid), 0) / 100;
  const balance = selected.reduce((sum, visit) => sum + cents(visit.balance), 0) / 100;

  const entered = amountText.trim() === "" ? null : Number(amountText);
  const amountValid =
    entered !== null &&
    Number.isFinite(entered) &&
    entered >= 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(amountText.trim()) &&
    entered <= 9_999_999_999.99;
  // Cash must be typed in. Other methods settle the full balance unless an amount is given.
  // Either way the amount must cover the whole balance.
  const amount = entered ?? (method === "cash" ? null : balance);
  const ready = amount !== null && (entered === null || amountValid);
  const underpaid = ready && cents(amount!) < cents(balance);
  const overNonCash = ready && method !== "cash" && cents(amount!) > cents(balance);
  const change =
    ready && method === "cash" && !underpaid ? (cents(amount!) - cents(balance)) / 100 : null;
  const canSubmit = selected.length > 0 && ready && !underpaid && !overNonCash;

  function toggle(visit: EligibleVisit) {
    const key = visitKey(visit);
    setSelectedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      // One receipt belongs to one customer: picking another customer starts over.
      const chosen = visits.find((item) => current.includes(visitKey(item)));
      const sameCustomer = chosen && chosen.customerId === visit.customerId;
      return sameCustomer ? [...current, key] : [key];
    });
    setAmountText("");
    setCheckoutError("");
    onVisitSelected();
  }

  async function checkout() {
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setProcessing(true);
    setCheckoutError("");
    const target =
      selected.length === 1 ? { visit: visitRef(first) } : { visits: selected.map(visitRef) };
    const payload = {
      ...target,
      paymentMethod: method,
      ...(method === "cash" || entered !== null ? { amountReceived: amount } : {}),
    };
    try {
      const response = await apiRequest("/api/transactions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await readApiBody<{
        success: boolean;
        transaction?: TransactionRecord;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.transaction) {
        throw new Error(
          body?.message ??
            (response.status === 409
              ? "This visit has already been paid or is no longer eligible."
              : "Unable to complete payment"),
        );
      }
      setSelectedKeys([]);
      setAmountText("");
      await onCompleted(body.transaction);
    } catch (error) {
      setCheckoutError(errorMessage(error, "Unable to complete payment"));
      if (error instanceof Error && /already exists|already been paid/i.test(error.message))
        void onReload();
    } finally {
      submitting.current = false;
      setProcessing(false);
    }
  }

  async function voidBalance() {
    if (submitting.current || !first || !voidReason.trim()) return;
    submitting.current = true;
    setProcessing(true);
    setCheckoutError("");
    try {
      const response = await apiRequest("/api/transactions/actions", {
        method: "POST",
        body: JSON.stringify({ visit: visitRef(first), reason: voidReason.trim() }),
      });
      const body = await readApiBody<{ success: boolean; message?: string }>(response);
      if (!response.ok || !body?.success) throw new Error(body?.message ?? "Unable to void");
      setVoiding(false);
      setVoidReason("");
      setSelectedKeys([]);
      onToast(`Balance voided for ${first.customerName}`);
      await onReload();
    } catch (error) {
      setCheckoutError(errorMessage(error, "Unable to void this visit"));
      setVoiding(false);
    } finally {
      submitting.current = false;
      setProcessing(false);
    }
  }

  return (
    <>
      <div className="checkout-workspace">
        <Panel className="eligible-visits-panel matched-height-panel">
          <SectionHeading title="Completed unpaid visits" />
          <FilterToolbar
            search={visitSearch}
            onSearchChange={setVisitSearch}
            placeholder="Search customer, service or visit"
            resultCount={loading || loadError ? undefined : matching.length}
            onReset={() => setVisitSearch("")}
          />
          <p className="form-hint">
            Select more than one service of the same customer to pay them on one receipt.
          </p>
          <div
            className="panel-scroll-body"
            role="region"
            aria-label="Completed unpaid visits"
            tabIndex={0}
          >
            {loading ? (
              <SkeletonRows count={3} label="Loading eligible visits" />
            ) : loadError ? (
              <p role="alert" className="operational-loading">
                Eligible visits unavailable. Refresh to retry.
              </p>
            ) : !visits.length ? (
              <EmptyState title="No visits ready for payment" />
            ) : (
              <div className="eligible-visit-list">
                {matching.map((visit) => (
                  <button
                    type="button"
                    key={visitKey(visit)}
                    aria-pressed={selectedKeys.includes(visitKey(visit))}
                    disabled={processing}
                    onClick={() => toggle(visit)}
                  >
                    <span>
                      <strong>{visit.customerName}</strong>
                      <small>
                        {visit.serviceName} · {visit.barberName}
                      </small>
                      <small>
                        {visit.visitType === "booking" ? "Booking" : "Walk-in"} #
                        {visit.visitRecordId}
                      </small>
                      {visit.paid > 0 && (
                        <small className="visit-balance">
                          <Badge tone="warning">Not fully paid</Badge> Paid {money(visit.paid)} ·
                          Balance {money(visit.balance)}
                        </small>
                      )}
                    </span>
                    <strong>{money(visit.balance)}</strong>
                  </button>
                ))}
                {visits.length > 0 && !matching.length && (
                  <EmptyState
                    title="No matching visits"
                    description="Reset search to see eligible visits."
                  />
                )}
              </div>
            )}
          </div>
        </Panel>
        <Panel className="payment-form-panel">
          <SectionHeading title="Checkout" />
          {!first && <EmptyState title="Select a visit to check out" />}
          {first && (
            <>
              <div className="payment-summary">
                <span>
                  <small>Customer</small>
                  <strong>{first.customerName}</strong>
                </span>
                {selected.map((visit) => (
                  <span key={visitKey(visit)}>
                    <small>
                      {visit.visitType === "booking" ? "Booking" : "Walk-in"} #{visit.visitRecordId}{" "}
                      · {visit.barberName}
                    </small>
                    <strong>
                      {visit.serviceName} · {money(visit.servicePrice)}
                    </strong>
                  </span>
                ))}
                <span>
                  <small>Total</small>
                  <strong>{money(total)}</strong>
                </span>
                {alreadyPaid > 0 && (
                  <span>
                    <small>Deposit / already paid</small>
                    <strong>− {money(alreadyPaid)}</strong>
                  </span>
                )}
                <span className="payment-summary__total">
                  <small>Balance due</small>
                  <strong>{money(balance)}</strong>
                </span>
              </div>
              <SelectField
                label="Payment method"
                value={method}
                disabled={processing}
                onChange={(event) => {
                  setMethod(event.target.value as PaymentMethod);
                  setCheckoutError("");
                }}
              >
                {methods.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Amount received"
                type="number"
                min="0"
                step="0.01"
                value={amountText}
                disabled={processing}
                placeholder={method === "cash" ? undefined : `Full balance ${money(balance)}`}
                onChange={(event) => setAmountText(event.target.value)}
                required={method === "cash"}
              />
              {amountText && !amountValid && (
                <p role="alert">Enter a valid amount with at most two decimal places.</p>
              )}
              {overNonCash && <p role="alert">The amount cannot be more than the balance due.</p>}
              {underpaid && (
                <p role="alert" className="underpayment-note">
                  The amount must cover the full balance of {money(balance)}.
                </p>
              )}
              {method === "cash" && (
                <p>
                  Change: <strong>{change === null ? "—" : money(change)}</strong>
                </p>
              )}
              {checkoutError && <p role="alert">{checkoutError}</p>}
              <Button
                type="button"
                size="lg"
                variant="success"
                icon="check"
                className="payment-submit"
                disabled={processing || loading || Boolean(loadError) || !canSubmit}
                onClick={() => setConfirming(true)}
              >
                {processing ? "Processing…" : "Complete payment"}
              </Button>
              {canVoid && selected.length === 1 && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={processing}
                  onClick={() => {
                    setVoidReason("");
                    setVoiding(true);
                  }}
                >
                  Void balance ({money(first.balance)})
                </Button>
              )}
            </>
          )}
        </Panel>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Complete this payment?"
        description={
          first && amount !== null
            ? `${first.customerName} · ${selected.length} service${selected.length === 1 ? "" : "s"} · Balance ${money(balance)} · ${methodLabel(method)}${method === "cash" ? ` · Received ${money(amount)} · Change ${money(change ?? 0)}` : ""}`
            : undefined
        }
        confirmLabel="Confirm payment"
        busy={processing}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void checkout();
        }}
      />
      <Modal
        open={voiding}
        title="Void the unpaid balance?"
        description="Manager only. Use for an underpayment or a special price. The reason is logged."
        onClose={() => !processing && setVoiding(false)}
      >
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void voidBalance();
          }}
        >
          {first && (
            <p className="modal-copy">
              {first.customerName} · {first.serviceName} · Price {money(first.total)} · Paid{" "}
              {money(first.paid)} · <strong>Voiding {money(first.balance)}</strong>
            </p>
          )}
          <TextField
            label="Reason"
            required
            maxLength={500}
            value={voidReason}
            placeholder="e.g. Senior citizen special price"
            onChange={(event) => setVoidReason(event.target.value)}
          />
          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={processing}
              onClick={() => setVoiding(false)}
            >
              Keep balance
            </Button>
            <Button type="submit" variant="danger" disabled={processing || !voidReason.trim()}>
              {processing ? "Voiding…" : "Void balance"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
