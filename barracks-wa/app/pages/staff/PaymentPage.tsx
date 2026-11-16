"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import { Button, EmptyState, Modal, PageHeader, Panel } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { FreshnessBar } from "@/app/components/operations/OperationalPrimitives";
import type { EligibleVisit, TransactionRecord } from "@/server/services/payment.service";
import { CheckoutWorkspace, type PartialPayment } from "./payment/CheckoutWorkspace";
import { loadMonthHistory } from "./payment/history";
import { manilaDate, methodLabel, money } from "./payment/labels";
import { TransactionCalendar } from "./payment/TransactionCalendar";
import { TransactionDayModal } from "./payment/TransactionDayModal";
import { TransactionDetailDrawer } from "./payment/TransactionDetailDrawer";
import { useTransactionDetail } from "./payment/useTransactionDetail";

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
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [visits, setVisits] = useState<EligibleVisit[]>([]);
  const [history, setHistory] = useState<TransactionRecord[]>([]);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [month, setMonth] = useState(() => manilaDate(new Date()).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const dateFrom = `${month}-01`;
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const monthDayCount = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const dateTo = `${month}-${String(monthDayCount).padStart(2, "0")}`;
  const [completed, setCompleted] = useState<TransactionRecord | null>(null);
  const [partial, setPartial] = useState<PartialPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
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

  const transactionsByDay = new Map<string, TransactionRecord[]>();
  for (const transaction of history) {
    const day = manilaDate(transaction.createdAt);
    const entries = transactionsByDay.get(day) ?? [];
    entries.push(transaction);
    transactionsByDay.set(day, entries);
  }
  const dayHistory = selectedDay ? (transactionsByDay.get(selectedDay) ?? []) : [];

  const detail = useTransactionDetail({
    branchId,
    canManageFinancialActions,
    onToast,
    reload: load,
  });

  function changeMonth(next: string) {
    setMonth(next);
    setDayOpen(false);
  }
  function openDetails(reference: string, print = false) {
    setDayOpen(false);
    void detail.openReceipt(reference, print);
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
        <CheckoutWorkspace
          visits={visits}
          loading={loading}
          loadError={loadError}
          onToast={onToast}
          canVoid={canManageFinancialActions}
          onVisitSelected={() => setCompleted(null)}
          onCompleted={async (transaction) => {
            setCompleted(transaction);
            await load();
          }}
          onPartial={async (result) => {
            setPartial(result);
            await load();
          }}
          onReload={load}
        />
      )}
      <TransactionCalendar
        history={history}
        transactionsByDay={transactionsByDay}
        loading={loading}
        loadError={loadError}
        month={month}
        search={search}
        methodFilter={methodFilter}
        onMonthChange={changeMonth}
        onSearch={setSearch}
        onMethodFilterChange={setMethodFilter}
        onResetFilters={() => {
          setSearch("");
          setMethodFilter("");
          setDayOpen(false);
        }}
        onOpenDay={(day) => {
          setSelectedDay(day);
          setDayOpen(true);
        }}
      />
      {dayOpen && selectedDay && (
        <TransactionDayModal
          day={selectedDay}
          dayHistory={dayHistory}
          loading={loading}
          loadError={loadError}
          filtered={Boolean(search || methodFilter)}
          onClose={() => setDayOpen(false)}
          onViewDetails={openDetails}
        />
      )}
      <Modal
        open={canCheckout && Boolean(completed)}
        title="Payment complete"
        onClose={() => setCompleted(null)}
      >
        {completed && (
          <div className="payment-popup" role="status">
            <span className="payment-popup__icon" aria-hidden="true">
              <Icon name="check" size={28} />
            </span>
            <p className="payment-popup__amount">
              {money(completed.receiptTotal ?? completed.total)}
            </p>
            <p>
              <strong>{completed.customerName}</strong> has paid in full.
            </p>
            <ul className="payment-popup__lines">
              {(completed.lines ?? []).map((line) => (
                <li key={line.reference}>
                  <span>{line.serviceName}</span>
                  <span>{money(line.amount)}</span>
                </li>
              ))}
            </ul>
            <p>
              {methodLabel(completed.paymentMethod)}
              {(completed.receiptPriorPaid ?? 0) > 0 &&
                ` · Deposit / paid earlier ${money(completed.receiptPriorPaid ?? 0)}`}
              {completed.paymentMethod === "cash" &&
                ` · Cash ${money(completed.receiptTendered ?? 0)} · Change ${money(completed.receiptChange ?? 0)}`}
            </p>
            <p className="payment-popup__reference">
              Reference {completed.receiptGroup ?? completed.reference}
            </p>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setCompleted(null)}>
                Done
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const reference = completed.reference;
                  setCompleted(null);
                  openDetails(reference, true);
                }}
              >
                Print receipt
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(partial)}
        title="Partial payment recorded"
        onClose={() => setPartial(null)}
      >
        {partial && (
          <div className="payment-popup payment-popup--partial" role="status">
            <p className="payment-popup__amount">{money(partial.balance)} still due</p>
            <p>
              <strong>{partial.customerName}</strong> · {partial.serviceName}
            </p>
            <p>
              Received now {money(partial.received)} · Paid so far {money(partial.paid)} of{" "}
              {money(partial.total)}
            </p>
            <p>
              This visit is <strong>not marked as paid</strong>. It stays under Completed unpaid
              visits until the balance is collected or a manager voids it.
            </p>
            <div className="modal-actions">
              <Button type="button" onClick={() => setPartial(null)}>
                OK
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <TransactionDetailDrawer
        detail={detail}
        canManageFinancialActions={canManageFinancialActions}
      />
    </div>
  );
}
