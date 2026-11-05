"use client";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import { useBranchContext } from "@/app/utils/use-branch-context";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import { Button, EmptyState, PageHeader, Panel, SectionHeading } from "@/app/components/ui";
import { BranchSwitcher } from "@/app/components/BranchSwitcher";
import { FreshnessBar } from "@/app/components/operations/OperationalPrimitives";
import type { EligibleVisit, TransactionRecord } from "@/server/services/payment.service";
import { CheckoutWorkspace } from "./payment/CheckoutWorkspace";
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
          onVisitSelected={() => setCompleted(null)}
          onCompleted={async (transaction) => {
            setCompleted(transaction);
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
          <Button type="button" onClick={() => openDetails(completed.reference, true)}>
            Print Receipt
          </Button>
        </Panel>
      )}
      <TransactionDetailDrawer
        detail={detail}
        canManageFinancialActions={canManageFinancialActions}
      />
    </div>
  );
}
