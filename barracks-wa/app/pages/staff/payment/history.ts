import { apiRequest, readApiBody } from "@/app/lib/api";
import type { TransactionRecord } from "@/server/services/payment.service";

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
export async function loadMonthHistory(
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
