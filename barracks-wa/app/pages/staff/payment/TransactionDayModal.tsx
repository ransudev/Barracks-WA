"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Modal, Pagination } from "@/app/components/ui";
import { SkeletonRows } from "@/app/components/ui/Skeletons";
import type { TransactionRecord } from "@/server/services/payment.service";
import { dayLabel, methodLabel, money, statusTone } from "./labels";

export function TransactionDayModal({
  day,
  dayHistory,
  loading,
  loadError,
  filtered,
  onClose,
  onViewDetails,
}: {
  day: string;
  dayHistory: TransactionRecord[];
  loading: boolean;
  loadError: string;
  filtered: boolean;
  onClose: () => void;
  onViewDetails: (reference: string) => void;
}) {
  const [page, setPage] = useState(1);
  const dayCompleted = dayHistory.filter((transaction) => transaction.status === "completed");
  const dayCompletedCount = dayCompleted.length;
  const dayCollected = dayCompleted.reduce((sum, transaction) => sum + transaction.total, 0);
  const dayAdjusted = dayHistory.length - dayCompletedCount;
  const totalPages = Math.max(1, Math.ceil(dayHistory.length / 20));
  const dayPage = Math.min(page, totalPages);

  return (
    <div className="transaction-day-modal">
      <Modal open title={dayLabel(day)} width="lg" onClose={onClose}>
        {loading ? (
          <SkeletonRows count={5} label="Loading transactions" />
        ) : loadError ? (
          <p role="alert" className="operational-loading">
            {loadError}
          </p>
        ) : !dayHistory.length ? (
          <EmptyState
            title="No transactions on this date"
            description={filtered ? "No transactions match the active filters." : undefined}
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
                    onClick={() => onViewDetails(transaction.reference)}
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
  );
}
