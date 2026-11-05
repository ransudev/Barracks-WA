import { useEffect, useRef, useState } from "react";
import { apiRequest, errorMessage, readApiBody } from "@/app/lib/api";
import type { TransactionRecord } from "@/server/services/payment.service";

export function useTransactionDetail({
  branchId,
  canManageFinancialActions,
  onToast,
  reload,
}: {
  branchId: number;
  canManageFinancialActions: boolean;
  onToast: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const receiptVersion = useRef(0);
  const [receipt, setReceipt] = useState<TransactionRecord | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);
  const printWhenReady = useRef(false);

  useEffect(() => {
    if (receipt && printWhenReady.current) {
      printWhenReady.current = false;
      window.print();
    }
  }, [receipt]);

  async function openReceipt(reference: string, print = false) {
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
      await reload();
    } catch (error) {
      setActionError(errorMessage(error, "Unable to update transaction"));
    } finally {
      setActionProcessing(false);
    }
  }

  function close() {
    if (actionProcessing) return;
    receiptVersion.current++;
    setDetailOpen(false);
    setReceipt(null);
  }

  return {
    detailOpen,
    receipt,
    receiptError,
    receiptLoading,
    actionReason,
    setActionReason,
    actionError,
    actionProcessing,
    openReceipt,
    applyAction,
    close,
  };
}
