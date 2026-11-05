"use client";

import { useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
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

export function CheckoutWorkspace({
  visits,
  loading,
  loadError,
  onToast,
  onVisitSelected,
  onCompleted,
  onReload,
}: {
  visits: EligibleVisit[];
  loading: boolean;
  loadError: string;
  onToast: (message: string) => void;
  onVisitSelected: () => void;
  onCompleted: (transaction: TransactionRecord) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [visitSearch, setVisitSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [processing, setProcessing] = useState(false);
  const submitting = useRef(false);
  const matching = visits.filter((visit) =>
    `${visit.customerName} ${visit.serviceName} ${visit.barberName} ${visit.visitRecordId}`
      .toLowerCase()
      .includes(visitSearch.trim().toLowerCase()),
  );
  const selected = visits.find((visit) => visitKey(visit) === selectedKey);
  const received = cashReceived.trim() === "" ? null : Number(cashReceived);
  const cashValid =
    received !== null &&
    Number.isFinite(received) &&
    received >= 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(cashReceived) &&
    received <= 9_999_999_999.99;
  const sufficient =
    selected && cashValid && Math.round(received! * 100) >= Math.round(selected.total * 100);
  const change = sufficient
    ? (Math.round(received! * 100) - Math.round(selected!.total * 100)) / 100
    : null;

  async function checkout() {
    if (submitting.current || !selected || (method === "cash" && !sufficient)) return;
    submitting.current = true;
    setProcessing(true);
    setCheckoutError("");
    const visit =
      selected.visitType === "booking"
        ? { bookingId: selected.visitRecordId }
        : { queueEntryId: selected.visitRecordId };
    const payload =
      method === "cash"
        ? { visit, paymentMethod: method, amountReceived: received }
        : { visit, paymentMethod: method };
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
      setSelectedKey("");
      setCashReceived("");
      onToast(`Payment completed: ${body.transaction.reference}`);
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
                    aria-pressed={selectedKey === visitKey(visit)}
                    disabled={processing}
                    onClick={() => {
                      setSelectedKey(visitKey(visit));
                      setCashReceived("");
                      onVisitSelected();
                      setCheckoutError("");
                    }}
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
                    </span>
                    <strong>{money(visit.total)}</strong>
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
          {!selected && <EmptyState title="Select a visit to check out" />}
          {selected && (
            <>
              <div className="payment-summary">
                <span>
                  <small>Visit</small>
                  <strong>
                    {selected.visitType === "booking" ? "Booking" : "Walk-in"} #
                    {selected.visitRecordId}
                  </strong>
                </span>
                <span>
                  <small>Customer</small>
                  <strong>{selected.customerName}</strong>
                </span>
                <span>
                  <small>Service</small>
                  <strong>{selected.serviceName}</strong>
                </span>
                <span>
                  <small>Barber</small>
                  <strong>{selected.barberName}</strong>
                </span>
                <span>
                  <small>Service price</small>
                  <strong>{money(selected.servicePrice)}</strong>
                </span>
                <span className="payment-summary__total">
                  <small>Total</small>
                  <strong>{money(selected.total)}</strong>
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
              {method === "cash" && (
                <>
                  <TextField
                    label="Amount received"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashReceived}
                    disabled={processing}
                    onChange={(event) => setCashReceived(event.target.value)}
                    required
                  />
                  {cashReceived && !cashValid && (
                    <p role="alert">Enter a valid cash amount with at most two decimal places.</p>
                  )}
                  {cashValid && !sufficient && (
                    <p role="alert">Cash received is below the total.</p>
                  )}
                  <p>
                    Change: <strong>{change === null ? "—" : money(change)}</strong>
                  </p>
                </>
              )}
              {checkoutError && <p role="alert">{checkoutError}</p>}
              <Button
                type="button"
                size="lg"
                variant="success"
                icon="check"
                className="payment-submit"
                disabled={
                  processing || loading || Boolean(loadError) || (method === "cash" && !sufficient)
                }
                onClick={() => setConfirming(true)}
              >
                {processing ? "Processing…" : "Complete payment"}
              </Button>
            </>
          )}
        </Panel>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Complete this payment?"
        description={
          selected
            ? `${selected.customerName} · ${selected.visitType} #${selected.visitRecordId} · ${money(selected.total)} · ${methodLabel(method)}${method === "cash" ? ` · Received ${money(received ?? 0)} · Change ${money(change ?? 0)}` : ""}`
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
    </>
  );
}
