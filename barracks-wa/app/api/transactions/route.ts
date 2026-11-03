import { listAccessibleBranches, resolveOperationalBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireStaffUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { createTransactionSchema, transactionHistorySchema } from "@/server/schemas/payment.schema";
import { formatValidationErrors } from "@/server/schemas/user.schema";
import { createTransaction, findTransactionByReference, listEligibleVisits, listTransactionHistory, PaymentServiceError } from "@/server/services/payment.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireStaffUser();
  if (user instanceof Response) return user;
  const params = new URL(request.url).searchParams;
  const reference = params.get("reference");
  const view = params.get("view");
  if ((reference && view) || (view && view !== "eligible" && view !== "history") || (!view && (!reference || reference.length > 64)) ||
      (view !== "history" && ["page", "pageSize", "search", "paymentMethod", "dateFrom", "dateTo"].some((key) => params.has(key)))) {
    return Response.json({ success: false, message: "Valid transaction reference or view required" }, { status: 400 });
  }
  const parsed = view === "history" ? transactionHistorySchema.safeParse(Object.fromEntries(
    ["page", "pageSize", "search", "paymentMethod", "dateFrom", "dateTo"]
      .filter((key) => params.has(key)).map((key) => [key, params.get(key)]),
  )) : null;
  if (parsed && !parsed.success) return Response.json({ success: false, message: "Invalid history filters" }, { status: 400 });
  try {
    const rawBranch = params.get("branchId");
    const branchIds = rawBranch !== null ? [await resolveOperationalBranch(pool, user, rawBranch)]
      : user.role === "administrator" ? undefined : (await listAccessibleBranches(pool, user)).map((branch) => branch.id);
    if (view === "eligible") return Response.json({ success: true, visits: await listEligibleVisits(pool, branchIds) });
    if (parsed?.success) return Response.json({ success: true, ...await listTransactionHistory(pool, parsed.data, branchIds) });
    const transaction = await findTransactionByReference(pool, reference!, branchIds);
    return transaction
      ? Response.json({ success: true, transaction: user.role === "front_desk" ? { ...transaction, actions: undefined } : transaction })
      : Response.json({ success: false, message: "Transaction not found" }, { status: 404 });
  } catch (error) {
    const branchError = visitBranchError(error); if (branchError) return branchError;
    console.error("Unable to load transaction", error);
    return Response.json({ success: false, message: "Unable to load transaction" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireStaffUser();
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Invalid payment information" }, { status: 400 }); }
  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid payment information", errors: formatValidationErrors(parsed.error) }, { status: 400 });
  try {
    const transaction = await createTransaction(pool, parsed.data, user.id);
    return Response.json({ success: true, transaction }, { status: 201 });
  } catch (error) {
    const branchError = visitBranchError(error); if (branchError) return branchError;
    if (error instanceof PaymentServiceError) {
      const status = error.kind === "forbidden" ? 403 : error.kind === "not_found" ? 404
        : error.kind === "insufficient_cash" ? 422 : 409;
      return Response.json({ success: false, message: error.message }, { status });
    }
    console.error("Unable to create transaction", error);
    return Response.json({ success: false, message: "Unable to create transaction" }, { status: 500 });
  }
}
