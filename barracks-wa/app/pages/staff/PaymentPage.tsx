"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { createPortal } from "react-dom";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import { formatCurrency } from "@/app/utils/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SectionHeading,
  SelectField,
  TextField,
} from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { Icon } from "@/app/components/ui/icons";
import {
  DetailDrawer,
  FreshnessBar,
  FilterToolbar,
} from "@/app/components/operations/OperationalPrimitives";
import type { EligibleVisit, TransactionRecord } from "@/server/services/payment.service";
import type { PaymentMethod } from "@/server/schemas/payment.schema";

const methods: { id: PaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "e_wallet", label: "E-wallet" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "other", label: "Other" },
];
const visitKey = (visit: EligibleVisit) => `${visit.visitType}:${visit.visitRecordId}`;
const methodLabel = (method: string) => methods.find((item) => item.id === method)?.label ?? method;
const money = (amount: number) => formatCurrency(amount);
const manilaDate = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "full",
  });
const historyUrl = (
  page: number,
  search: string,
  paymentMethod: string,
  dateFrom: string,
  dateTo: string,
) => {
  const params = new URLSearchParams({ view: "history", page: String(page), pageSize: "100" });
  if (search.trim()) params.set("search", search.trim());
  if (paymentMethod) params.set("paymentMethod", paymentMethod);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return `/api/transactions?${params}`;
};
async function loadMonthHistory(
  search: string,
  paymentMethod: string,
  dateFrom: string,
  dateTo: string,
  branchId: number,
  isCurrent: () => boolean,
) {
  const transactions: TransactionRecord[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const response = await apiRequest(
      `${historyUrl(page, search, paymentMethod, dateFrom, dateTo)}&branchId=${branchId}`,
      { cache: "no-store" },
    );
    const body = await readApiBody<{
      success: boolean;
      transactions?: TransactionRecord[];
      totalPages?: number;
      message?: string;
    }>(response);
    if (!isCurrent()) return null;
    if (!response.ok || !body?.success || !body.transactions)
      throw new Error(body?.message ?? "Unable to load transaction calendar");
    totalPages = body.totalPages ?? 1;
    if (totalPages > 10000)
      throw new Error("Too many transactions in this month. Narrow the search or payment method.");
    transactions.push(...body.transactions);
  }
  return transactions;
}

function Receipt({
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

export function PaymentPage({
  onToast,
  canCheckout = false,
  canManageFinancialActions = false,
}: {
  onToast: (message: string) => void;
  canCheckout?: boolean;
  canManageFinancialActions?: boolean;
}) {
  const { branches, branchId, setBranchId, branchError, branchLoading } = useBranchContext();
  const branchControl = (
    <BranchSwitcher
      branches={branches}
      value={branchId}
      loading={branchLoading}
      onChange={setBranchId}
    />
  );
  if (branchId > 0)
    return (
      <PaymentBranch
        key={branchId}
        branchId={branchId}
        branchControl={branchControl}
        onToast={onToast}
        canCheckout={canCheckout}
        canManageFinancialActions={canManageFinancialActions}
      />
    );
  return (
    <div className="operational-workspace">
      <PageHeader title={canCheckout ? "Payments" : "Transactions"} action={branchControl} />
      {branchError ? (
        <p role="alert">{branchError}</p>
      ) : branchLoading ? (
        <Panel>
          <SkeletonRows count={5} label="Loading payments" />
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon="creditCard"
            title="No branch assigned"
            description="Ask an administrator to assign you to a branch."
          />
        </Panel>
      )}
    </div>
  );
}

const statusTone = (status: string) =>
  status === "completed"
    ? "success"
    : ["refunded", "partially_refunded", "pending"].includes(status)
      ? "warning"
      : "danger";

function PaymentBranch({
  branchId,
  branchControl,
  onToast,
  canCheckout,
  canManageFinancialActions,
}: {
  branchId: number;
  branchControl: ReactNode;
  onToast: (message: string) => void;
  canCheckout: boolean;
  canManageFinancialActions: boolean;
}) {
  const [visitSearch, setVisitSearch] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"refund" | "void" | "checkout" | null>(null);
  const receiptVersion = useRef(0);
  const [visits, setVisits] = useState<EligibleVisit[]>([]);
  const [history, setHistory] = useState<TransactionRecord[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [month, setMonth] = useState(() => manilaDate(new Date()).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const dateFrom = `${month}-01`;
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const monthDayCount = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const dateTo = `${month}-${String(monthDayCount).padStart(2, "0")}`;
  const [receipt, setReceipt] = useState<TransactionRecord | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);
  const printWhenReady = useRef(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [completed, setCompleted] = useState<TransactionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [processing, setProcessing] = useState(false);
  const submitting = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [visitsResponse, monthHistory] = await Promise.all([
        canCheckout
          ? apiRequest(`/api/transactions?view=eligible&branchId=${branchId}`, {
              cache: "no-store",
            })
          : Promise.resolve(null),
        loadMonthHistory(
          search,
          methodFilter,
          dateFrom,
          dateTo,
          branchId,
          () => version === requestVersion.current,
        ),
      ]);
      const [visitsBody] = await Promise.all([
        visitsResponse
          ? readApiBody<{ success: boolean; visits?: EligibleVisit[]; message?: string }>(
              visitsResponse,
            )
          : Promise.resolve(null),
      ]);
      if (
        (canCheckout && (!visitsResponse?.ok || !visitsBody?.success || !visitsBody.visits)) ||
        !monthHistory
      ) {
        if (version !== requestVersion.current) return;
        throw new Error(visitsBody?.message ?? "Unable to load payments");
      }
      if (version !== requestVersion.current) return;
      setVisits(visitsBody?.visits ?? []);
      setHistory(monthHistory);
      setSelectedKey((current) =>
        visitsBody?.visits?.some((visit) => visitKey(visit) === current) ? current : "",
      );
      setLoadError("");
      setUpdatedAt(Date.now());
    } catch (error) {
      if (version === requestVersion.current)
        setLoadError(errorMessage(error, "Unable to load payments"));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [branchId, canCheckout, search, methodFilter, dateFrom, dateTo]);

  useEffect(() => {
    const versionRef = requestVersion;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
      versionRef.current++;
    };
  }, [load]);

  const selected = visits.find((visit) => visitKey(visit) === selectedKey);
  const transactionsByDay = new Map<string, TransactionRecord[]>();
  for (const transaction of history) {
    const day = manilaDate(transaction.createdAt);
    const entries = transactionsByDay.get(day) ?? [];
    entries.push(transaction);
    transactionsByDay.set(day, entries);
  }
  const dayHistory = selectedDay ? (transactionsByDay.get(selectedDay) ?? []) : [];
  const dayCompleted = dayHistory.filter((transaction) => transaction.status === "completed");
  const dayCompletedCount = dayCompleted.length;
  const dayCollected = dayCompleted.reduce((sum, transaction) => sum + transaction.total, 0);
  const dayAdjusted = dayHistory.length - dayCompletedCount;
  const monthTotal = history.reduce(
    (sum, transaction) => sum + (transaction.status === "completed" ? transaction.total : 0),
    0,
  );
  const today = manilaDate(new Date());
  const currentMonth = today.slice(0, 7);
  const totalPages = Math.max(1, Math.ceil(dayHistory.length / 20));
  const dayPage = Math.min(page, totalPages);
  const monthStart = new Date(`${dateFrom}T12:00:00Z`);
  const calendarOffset = (monthStart.getUTCDay() + 6) % 7;
  const calendarDays = Array.from(
    { length: monthDayCount },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const moveMonth = (offset: number) => {
    const next = new Date(`${dateFrom}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + offset);
    setMonth(next.toISOString().slice(0, 7));
    setDayOpen(false);
    setPage(1);
  };
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

  useEffect(() => {
    if (receipt && printWhenReady.current) {
      printWhenReady.current = false;
      window.print();
    }
  }, [receipt]);

  async function openReceipt(reference: string, print = false) {
    setDayOpen(false);
    const version = ++receiptVersion.current;
    setDetailOpen(true);
    setReceipt(null);
    setReceiptError("");
    setActionReason("");
    setActionError("");
    printWhenReady.current = false;
    setReceiptLoading(true);
    try {
      const response = await apiRequest(
        `/api/transactions?reference=${encodeURIComponent(reference)}&branchId=${branchId}`,
        { cache: "no-store" },
      );
      const body = await readApiBody<{
        success: boolean;
        transaction?: TransactionRecord;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.transaction)
        throw new Error(body?.message ?? "Unable to load receipt");
      if (version !== receiptVersion.current) return;
      printWhenReady.current = print;
      setReceipt(body.transaction);
    } catch (error) {
      if (version === receiptVersion.current)
        setReceiptError(errorMessage(error, "Unable to load receipt"));
    } finally {
      if (version === receiptVersion.current) setReceiptLoading(false);
    }
  }

  async function applyAction(action: "refund" | "void") {
    if (!canManageFinancialActions || !receipt || actionProcessing || !actionReason.trim()) return;
    setActionProcessing(true);
    setActionError("");
    try {
      const response = await apiRequest("/api/transactions/actions", {
        method: "POST",
        body: JSON.stringify({
          reference: receipt.reference,
          action,
          amount: receipt.total,
          reason: actionReason.trim(),
        }),
      });
      const body = await readApiBody<{
        success: boolean;
        transaction?: TransactionRecord;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success || !body.transaction)
        throw new Error(body?.message ?? "Unable to update transaction");
      setReceipt(body.transaction);
      setActionReason("");
      onToast(`Transaction ${body.transaction.status}: ${body.transaction.reference}`);
      await load();
    } catch (error) {
      setActionError(errorMessage(error, "Unable to update transaction"));
    } finally {
      setActionProcessing(false);
    }
  }

  async function checkout() {
    if (!canCheckout || submitting.current || !selected || (method === "cash" && !sufficient))
      return;
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
      setCompleted(body.transaction);
      setSelectedKey("");
      setCashReceived("");
      onToast(`Payment completed: ${body.transaction.reference}`);
      await load();
    } catch (error) {
      setCheckoutError(errorMessage(error, "Unable to complete payment"));
      if (error instanceof Error && /already exists|already been paid/i.test(error.message))
        void load();
    } finally {
      submitting.current = false;
      setProcessing(false);
    }
  }

  return (
    <div className="operational-workspace">
      <PageHeader
        title={canCheckout ? "Payments" : "Transactions"}
        action={
          <>
            <FreshnessBar
              updatedAt={updatedAt}
              loading={loading}
              error={loadError}
              onRefresh={() => void load()}
            />
            {branchControl}
          </>
        }
      />
      {canCheckout && (
        <div className="checkout-workspace">
          <Panel className="eligible-visits-panel matched-height-panel">
            <SectionHeading title="Completed unpaid visits" />
            <FilterToolbar
              search={visitSearch}
              onSearchChange={setVisitSearch}
              placeholder="Search customer, service or visit"
              resultCount={
                loading || loadError
                  ? undefined
                  : visits.filter((visit) =>
                      `${visit.customerName} ${visit.serviceName} ${visit.barberName} ${visit.visitRecordId}`
                        .toLowerCase()
                        .includes(visitSearch.trim().toLowerCase()),
                    ).length
              }
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
                  {visits
                    .filter((visit) =>
                      `${visit.customerName} ${visit.serviceName} ${visit.barberName} ${visit.visitRecordId}`
                        .toLowerCase()
                        .includes(visitSearch.trim().toLowerCase()),
                    )
                    .map((visit) => (
                      <button
                        type="button"
                        key={visitKey(visit)}
                        aria-pressed={selectedKey === visitKey(visit)}
                        disabled={processing}
                        onClick={() => {
                          setSelectedKey(visitKey(visit));
                          setCashReceived("");
                          setCompleted(null);
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
                  {visits.length > 0 &&
                    !visits.some((visit) =>
                      `${visit.customerName} ${visit.serviceName} ${visit.barberName} ${visit.visitRecordId}`
                        .toLowerCase()
                        .includes(visitSearch.trim().toLowerCase()),
                    ) && (
                      <EmptyState
                        title="No matching visits"
                        description="Reset search to see eligible visits."
                      />
                    )}
                </div>
              )}
            </div>
          </Panel>
          {canCheckout && (
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
                        <p role="alert">
                          Enter a valid cash amount with at most two decimal places.
                        </p>
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
                      processing ||
                      loading ||
                      Boolean(loadError) ||
                      (method === "cash" && !sufficient)
                    }
                    onClick={() => setPendingAction("checkout")}
                  >
                    {processing ? "Processing…" : "Complete payment"}
                  </Button>
                </>
              )}
            </Panel>
          )}
        </div>
      )}
      <Panel className="recent-transactions-panel">
        <div className="transaction-calendar-head">
          <div className="transaction-calendar-navigation">
            <IconButton label="Previous month" icon="chevronLeft" onClick={() => moveMonth(-1)} />
            <h2>
              {monthStart.toLocaleDateString("en-PH", {
                timeZone: "Asia/Manila",
                month: "long",
                year: "numeric",
              })}
            </h2>
            <IconButton label="Next month" icon="chevronRight" onClick={() => moveMonth(1)} />
            {month !== currentMonth && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMonth(currentMonth);
                  setDayOpen(false);
                  setPage(1);
                }}
              >
                Today
              </Button>
            )}
          </div>
          {!loading && !loadError && (
            <p className="transaction-calendar-total">
              <span>
                {history.length} transactions this month
                {search || methodFilter ? " matching the active filters" : ""}.
              </span>
              <strong>{money(monthTotal)}</strong>
            </p>
          )}
        </div>
        <form
          className="transaction-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput);
          }}
        >
          <label className="search-input transaction-filters__search">
            <Icon name="search" size={16} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search reference or customer"
              aria-label="Reference or customer"
            />
          </label>
          <SelectField
            value={methodFilter}
            aria-label="Payment method"
            onChange={(event) => {
              setPage(1);
              setMethodFilter(event.target.value);
            }}
          >
            <option value="">All methods</option>
            {methods.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <TextField
            className="transaction-filters__month"
            type="month"
            value={month}
            aria-label="Month"
            onChange={(event) => {
              if (event.target.value) {
                setMonth(event.target.value);
                setDayOpen(false);
                setPage(1);
              }
            }}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {(search || searchInput || methodFilter) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setMethodFilter("");
                setDayOpen(false);
                setPage(1);
              }}
            >
              Reset filters
            </Button>
          )}
        </form>
        {loading && (
          <p role="status" className="operational-loading">
            Loading transaction calendar…
          </p>
        )}
        {!loading && loadError && (
          <p role="alert" className="operational-loading">
            {loadError}
          </p>
        )}
        {!loading && !loadError && (
          <div className="transaction-calendar" aria-label="Transaction dates">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="transaction-calendar__weekday">
                {day}
              </div>
            ))}
            {Array.from({ length: calendarOffset }, (_, index) => (
              <div
                key={`blank-${index}`}
                aria-hidden="true"
                className="transaction-calendar__blank"
              />
            ))}
            {calendarDays.map((day) => {
              const entries = transactionsByDay.get(day) ?? [];
              const count = entries.length;
              const total = entries.reduce(
                (sum, entry) => sum + (entry.status === "completed" ? entry.total : 0),
                0,
              );
              return (
                <button
                  type="button"
                  key={day}
                  className={`transaction-calendar__day${count ? " has-activity" : ""}${day > today ? " is-future" : ""}`}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={`${dayLabel(day)}, ${count} ${count === 1 ? "transaction" : "transactions"}`}
                  onClick={() => {
                    setSelectedDay(day);
                    setDayOpen(true);
                    setPage(1);
                  }}
                >
                  <span>{Number(day.slice(-2))}</span>
                  {count > 0 && (
                    <>
                      <strong>{money(total)}</strong>
                      <small>
                        {count} {count === 1 ? "sale" : "sales"}
                      </small>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Panel>
      <div className="transaction-day-modal">
        <Modal
          open={dayOpen}
          title={selectedDay ? dayLabel(selectedDay) : "Daily transactions"}
          width="lg"
          onClose={() => setDayOpen(false)}
        >
          {loading ? (
            <SkeletonRows count={5} label="Loading transactions" />
          ) : loadError ? (
            <p role="alert" className="operational-loading">
              {loadError}
            </p>
          ) : !dayHistory.length ? (
            <EmptyState
              title="No transactions on this date"
              description={
                search || methodFilter ? "No transactions match the active filters." : undefined
              }
            />
          ) : (
            <>
              <div className="transaction-day-summary">
                <div>
                  <span>Collected</span>
                  <strong className="is-positive">{money(dayCollected)}</strong>
                </div>
                <div>
                  <span>Transactions</span>
                  <strong>{dayHistory.length}</strong>
                </div>
                <div>
                  <span>Average</span>
                  <strong>
                    {money(dayHistory.length ? dayCollected / Math.max(1, dayCompletedCount) : 0)}
                  </strong>
                </div>
                {dayAdjusted > 0 && (
                  <div>
                    <span>Refunded / voided</span>
                    <strong className="is-negative">{dayAdjusted}</strong>
                  </div>
                )}
              </div>
              <ul className="transaction-day-list">
                {dayHistory.slice((dayPage - 1) * 20, dayPage * 20).map((transaction) => (
                  <li
                    key={transaction.id}
                    className={transaction.status !== "completed" ? "is-adjusted" : undefined}
                  >
                    <time dateTime={transaction.createdAt}>
                      {new Date(transaction.createdAt).toLocaleTimeString("en-PH", {
                        timeZone: "Asia/Manila",
                        timeStyle: "short",
                      })}
                    </time>
                    <div className="transaction-day-list__identity">
                      <strong>{transaction.customerName}</strong>
                      <span>
                        {transaction.serviceName} · {transaction.barberName}
                      </span>
                    </div>
                    <span className="transaction-day-list__method">
                      {methodLabel(transaction.paymentMethod)}
                      {transaction.paymentStatus !== "completed" && (
                        <Badge tone={statusTone(transaction.paymentStatus)}>
                          {transaction.paymentStatus}
                        </Badge>
                      )}
                    </span>
                    <strong className="transaction-day-list__amount">
                      {money(transaction.total)}
                    </strong>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void openReceipt(transaction.reference)}
                    >
                      View details
                    </Button>
                  </li>
                ))}
              </ul>
              <Pagination
                className="transaction-pages"
                page={dayPage}
                pageCount={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </Modal>
      </div>
      {canCheckout && completed && (
        <Panel>
          <SectionHeading title="Payment completed" />
          <p>
            Reference: <strong>{completed.reference}</strong>
          </p>
          <p>
            {completed.customerName} · {completed.serviceName} · {completed.barberName}
          </p>
          <p>
            Service price: {money(completed.subtotal)} · Total: {money(completed.total)} ·{" "}
            {methodLabel(completed.paymentMethod)}
          </p>
          {completed.paymentMethod === "cash" && (
            <p>
              Received: {money(completed.amountReceived ?? 0)} · Change:{" "}
              {money(completed.change ?? 0)}
            </p>
          )}
          <Button type="button" onClick={() => void openReceipt(completed.reference, true)}>
            Print Receipt
          </Button>
        </Panel>
      )}
      <DetailDrawer
        open={detailOpen}
        title="Transaction details"
        subtitle={receipt?.reference}
        onClose={() => {
          if (actionProcessing) return;
          receiptVersion.current++;
          setDetailOpen(false);
          setReceipt(null);
        }}
      >
        {receiptLoading && <p role="status">Loading transaction…</p>}
        {receiptError && <p role="alert">{receiptError}</p>}
        {receipt && (
          <>
            <Receipt
              transaction={receipt}
              onClose={() => {
                if (actionProcessing) return;
                receiptVersion.current++;
                setDetailOpen(false);
                setReceipt(null);
              }}
            />
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
        title={
          pendingAction === "checkout"
            ? "Complete this payment?"
            : pendingAction === "refund"
              ? "Refund this transaction?"
              : "Void this transaction?"
        }
        description={
          pendingAction === "checkout" && selected
            ? `${selected.customerName} · ${selected.visitType} #${selected.visitRecordId} · ${money(selected.total)} · ${methodLabel(method)}${method === "cash" ? ` · Received ${money(received ?? 0)} · Change ${money(change ?? 0)}` : ""}`
            : receipt
              ? `${receipt.reference} · ${money(receipt.total)} · ${actionReason}`
              : undefined
        }
        confirmLabel={pendingAction === "checkout" ? "Confirm payment" : "Confirm action"}
        danger={pendingAction !== "checkout"}
        busy={processing || actionProcessing}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === "checkout") void checkout();
          else if (action) void applyAction(action);
        }}
      />
    </div>
  );
}
