import { checkBranchAccess } from "@/server/auth/branch-access";
import type { Db } from "@/server/db/transaction";
import type { UserRole } from "@/server/schemas/user.schema";
import type { Pool } from "pg";
import type { CreateTransactionInput, FinancialActionInput, PaymentMethod, PaymentStatus, TransactionHistoryInput } from "@/server/schemas/payment.schema";

type VisitRow = {
  branch_id: number;
  booking_id: number | null; queue_entry_id: number | null; customer_id: number;
  barber_id: number; service_id: string; customer_name: string;
  barber_name: string; service_name: string; amount: string; visit_status: string;
};
type TransactionRow = VisitRow & {
  id: string; reference: string; visit_type: "booking" | "queue" | "legacy"; visit_record_id: string;
  processed_by: number | null; cashier_name: string | null;
  payment_method: PaymentMethod | "mixed"; status: PaymentStatus; created_at: Date | string;
  amount_received: string | null; change_amount: string | null;
  prior_paid?: string | null; receipt_group?: string | null;
  actions?: FinancialActionRow[] | null;
  voidable?: boolean | null;
  lines?: ReceiptLineRow[] | null;
  branch_name?: string | null; branch_address?: string | null; branch_phone?: string | null; branch_tin?: string | null;
  void_note?: { original: string; voided: string; reason: string; staff_name: string } | null;
};
type ReceiptLineRow = { reference: string; service_name: string; barber_name: string; amount: string; status: PaymentStatus; prior_paid: string; received: string | null; change: string | null };
export type ReceiptLine = { reference: string; serviceName: string; barberName: string; amount: number; status: PaymentStatus; priorPaid: number };
export type ReceiptBusiness = { name: string; address: string; phone: string; tin: string };

type FinancialActionRow = { id: string; transaction_id: string; action_type: "refund" | "void"; amount: string; reason: string; staff_id: number | null; staff_name: string; created_at: Date | string };
export type FinancialActionRecord = { id: number; transactionId: number; action: "refund" | "void"; amount: number; reason: string; staffId: number | null; staffName: string; createdAt: string };

export type TransactionRecord = {
  branchId: number;
  id: number; reference: string; visitType: "booking" | "queue" | "legacy"; visitRecordId: number;
  bookingId: number | null; queueEntryId: number | null;
  customerId: number; barberId: number; serviceId: string; processedBy: number | null;
  customerName: string; barberName: string; cashierName: string | null; serviceName: string;
  amount: number; subtotal: number; total: number; paymentMethod: PaymentMethod | "mixed";
  amountReceived: number | null; change: number | null;
  status: PaymentStatus; paymentStatus: PaymentStatus; createdAt: string;
  actions?: FinancialActionRecord[];
  // Present on single-transaction reads.
  voidable?: boolean;
  // Deposit and partial payments collected before this final tender.
  priorPaid: number;
  // Cash handed over at this checkout (cash tenders only).
  tendered: number | null;
  receiptGroup: string | null;
  // Receipt reads: every service paid together, and the grand totals.
  lines?: ReceiptLine[];
  receiptTotal?: number;
  receiptPriorPaid?: number;
  // Cash handed over and change given across the whole receipt.
  receiptTendered?: number | null;
  receiptChange?: number | null;
  business?: ReceiptBusiness;
  // Set when a manager voided the unpaid balance (underpayment or special price).
  balanceVoid?: { originalAmount: number; voidedAmount: number; reason: string; staffName: string };
};

export type EligibleVisit = {
  branchId: number;
  visitType: "booking" | "queue"; visitRecordId: number; customerId: number;
  customerName: string; serviceName: string; barberName: string; servicePrice: number; total: number;
  // Verified booking deposit, everything collected so far, and what is still owed.
  deposit: number; paid: number; balance: number;
};

export class PaymentServiceError extends Error {
  constructor(public readonly kind: "not_found" | "conflict" | "forbidden" | "invalid_state" | "insufficient_cash", message: string) {
    super(message);
  }
}

function toTransaction(row: TransactionRow): TransactionRecord {
  return {
    branchId: Number(row.branch_id), id: Number(row.id), reference: row.reference, visitType: row.visit_type, visitRecordId: Number(row.visit_record_id),
    bookingId: row.booking_id === null ? null : Number(row.booking_id),
    queueEntryId: row.queue_entry_id === null ? null : Number(row.queue_entry_id),
    customerId: Number(row.customer_id), barberId: Number(row.barber_id), serviceId: row.service_id,
    processedBy: row.processed_by === null ? null : Number(row.processed_by),
    customerName: row.customer_name, barberName: row.barber_name, cashierName: row.cashier_name,
    serviceName: row.service_name, amount: Number(row.amount), subtotal: Number(row.amount), total: Number(row.amount),
    paymentMethod: row.payment_method, amountReceived: row.amount_received === null ? null : Number(row.amount_received),
    change: row.change_amount === null ? null : Number(row.change_amount),
    status: row.status, paymentStatus: row.status, createdAt: new Date(row.created_at).toISOString(),
    ...(row.actions && { actions: row.actions.map((action) => ({ id: Number(action.id), transactionId: Number(action.transaction_id),
      action: action.action_type, amount: Number(action.amount), reason: action.reason,
      staffId: action.staff_id === null ? null : Number(action.staff_id), staffName: action.staff_name,
      createdAt: new Date(action.created_at).toISOString() })) }),
    ...(typeof row.voidable === "boolean" && { voidable: row.voidable }),
    priorPaid: Number(row.prior_paid ?? 0),
    tendered: row.amount_received === null ? null
      : Math.round((Number(row.amount_received) - Number(row.prior_paid ?? 0)) * 100) / 100,
    receiptGroup: row.receipt_group ?? null,
    ...(row.lines && {
      lines: row.lines.map((line) => ({ reference: line.reference, serviceName: line.service_name, barberName: line.barber_name,
        amount: Number(line.amount), status: line.status, priorPaid: Number(line.prior_paid) })),
      receiptTotal: row.lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) / 100,
      receiptPriorPaid: row.lines.reduce((sum, line) => sum + Math.round(Number(line.prior_paid) * 100), 0) / 100,
      receiptTendered: row.lines.some((line) => line.received === null) ? null
        : row.lines.reduce((sum, line) => sum + Math.round((Number(line.received) - Number(line.prior_paid)) * 100), 0) / 100,
      receiptChange: row.lines.some((line) => line.change === null) ? null
        : row.lines.reduce((sum, line) => sum + Math.round(Number(line.change) * 100), 0) / 100,
    }),
    ...(typeof row.branch_name === "string" && { business: { name: row.branch_name, address: row.branch_address ?? "",
      phone: row.branch_phone ?? "", tin: row.branch_tin ?? "" } }),
    ...(row.void_note && { balanceVoid: { originalAmount: Number(row.void_note.original), voidedAmount: Number(row.void_note.voided),
      reason: row.void_note.reason, staffName: row.void_note.staff_name } }),
  };
}

export async function findTransactionByReference(db: Db, reference: string, branchIds?: number[]): Promise<TransactionRecord | null> {
  const result = await db.query<TransactionRow>(
    `SELECT t.*,p.amount_received,p.change_amount,
       (SELECT json_agg(a ORDER BY a.created_at,a.id) FROM transaction_financial_actions a WHERE a.transaction_id=t.id) AS actions,
       (t.status='completed') AS voidable,
       -- Every service paid together prints on the same receipt.
       (SELECT json_agg(json_build_object('reference',g.reference,'service_name',g.service_name,'barber_name',g.barber_name,
          'amount',g.amount,'status',g.status,'prior_paid',g.prior_paid,
          'received',gp.amount_received,'change',gp.change_amount) ORDER BY g.id)
        FROM transactions g JOIN transaction_payments gp ON gp.transaction_id=g.id WHERE g.id=t.id OR (t.receipt_group IS NOT NULL AND g.receipt_group=t.receipt_group)) AS lines,
       br.name AS branch_name, br.address AS branch_address, br.phone AS branch_phone, br.tin AS branch_tin,
       (SELECT json_build_object('original',v.amount_due,'voided',v.voided_amount,'reason',v.reason,'staff_name',v.staff_name)
        FROM visit_voids v WHERE v.visit_type=t.visit_type AND v.visit_record_id=t.visit_record_id) AS void_note
     FROM transactions t JOIN transaction_payments p ON p.transaction_id=t.id JOIN branches br ON br.id=t.branch_id WHERE t.reference=$1 AND ($2::integer[] IS NULL OR t.branch_id=ANY($2))`, [reference, branchIds ?? null]);
  return result.rows[0] ? toTransaction(result.rows[0]) : null;
}

export async function listTransactions(db: Pool, branchIds?: number[]): Promise<TransactionRecord[]> {
  const result = await db.query<TransactionRow>(
    `SELECT t.*,p.amount_received,p.change_amount FROM transactions t
     JOIN transaction_payments p ON p.transaction_id=t.id
     WHERE ($1::integer[] IS NULL OR t.branch_id=ANY($1))
     ORDER BY t.created_at DESC,t.id DESC LIMIT 100`, [branchIds ?? null],
  );
  return result.rows.map(toTransaction);
}

export async function listTransactionHistory(db: Pool, filters: TransactionHistoryInput, branchIds?: number[]) {
  const conditions: string[] = [];
  const values: (string | number | number[])[] = [];
  if (branchIds !== undefined) {
    values.push(branchIds);
    conditions.push(`t.branch_id=ANY($${values.length}::integer[])`);
  }
  if (filters.search) {
    values.push(filters.search);
    conditions.push(`(strpos(lower(t.reference),lower($${values.length})) > 0 OR strpos(lower(t.customer_name),lower($${values.length})) > 0)`);
  }
  if (filters.paymentMethod) {
    values.push(filters.paymentMethod);
    conditions.push(`t.payment_method=$${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(`${filters.dateFrom}T00:00:00+08:00`);
    conditions.push(`t.created_at >= $${values.length}::timestamptz`);
  }
  if (filters.dateTo) {
    const nextDay = new Date(`${filters.dateTo}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    values.push(`${nextDay.toISOString().slice(0, 10)}T00:00:00+08:00`);
    conditions.push(`t.created_at < $${values.length}::timestamptz`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await db.query<{ count: string }>(`SELECT count(*) FROM transactions t ${where}`, values);
  const total = Number(count.rows[0].count);
  const page = filters.page;
  const pageSize = filters.pageSize;
  const result = await db.query<TransactionRow>(
    `SELECT t.*,p.amount_received,p.change_amount FROM transactions t
     JOIN transaction_payments p ON p.transaction_id=t.id ${where}
     ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { transactions: result.rows.map(toTransaction), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function applyFinancialAction(db: Pool, reference: string, input: FinancialActionInput, staffId: number): Promise<TransactionRecord> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const staff = await client.query<{ name: string; role: UserRole }>(
      `SELECT concat_ws(' ',u.first_name,u.last_name) AS name,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified=TRUE AND u.is_blocked=FALSE
       AND r.name IN ('administrator','manager') FOR SHARE OF u`, [staffId]);
    if (!staff.rows[0]) throw new PaymentServiceError("forbidden", "Administrator or manager access is required");
    const result = await client.query<{ id: string; amount: string; status: PaymentStatus; branch_id: number }>(
      "SELECT id,amount,status,branch_id FROM transactions WHERE reference=$1 FOR UPDATE", [reference]);
    const transaction = result.rows[0];
    if (!transaction) throw new PaymentServiceError("not_found", "Transaction not found");
    if (!await checkBranchAccess(client, { id: staffId, role: staff.rows[0].role }, Number(transaction.branch_id)))
      throw new PaymentServiceError("forbidden", "You do not have access to this transaction branch");
    if (transaction.status !== "completed") throw new PaymentServiceError("invalid_state", "Only a completed transaction that has not been reversed can be voided");
    if (Math.round(input.amount * 100) !== Math.round(Number(transaction.amount) * 100)) {
      throw new PaymentServiceError("invalid_state", "Action amount must equal the full paid amount");
    }
    // Refunds were retired; Void is the only reversal. The barber keeps the
    // commission for the service already rendered.
    const status = "voided";
    await client.query(
      `INSERT INTO transaction_financial_actions(transaction_id,action_type,amount,reason,staff_id,staff_name)
       VALUES($1,$2,$3,$4,$5,$6)`, [transaction.id, input.action, input.amount, input.reason, staffId, staff.rows[0].name]);
    await client.query("UPDATE transactions SET status=$2 WHERE id=$1", [transaction.id, status]);
    await client.query("UPDATE transaction_payments SET status=$2 WHERE transaction_id=$1", [transaction.id, status]);
    // Read on this connection so a small pool cannot wait on itself.
    const updated = await findTransactionByReference(client, reference);
    if (!updated) throw new Error("Updated transaction missing");
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

// What has already been collected for a completed visit: a verified booking
// deposit plus any partial payments. Shared by every balance calculation.
const bookingPaidSql = `(CASE WHEN b.deposit_status='received' THEN b.deposit_amount ELSE 0 END
  + COALESCE((SELECT sum(pp.amount) FROM visit_partial_payments pp WHERE pp.visit_type='booking' AND pp.visit_record_id=b.id),0))`;
const queuePaidSql = `COALESCE((SELECT sum(pp.amount) FROM visit_partial_payments pp WHERE pp.visit_type='queue' AND pp.visit_record_id=q.id),0)`;

export async function listEligibleVisits(db: Pool, branchIds?: number[]): Promise<EligibleVisit[]> {
  const result = await db.query<{
    branch_id: number; visit_type: "booking" | "queue"; visit_record_id: string; customer_id: number;
    customer_name: string; service_name: string; barber_name: string; service_price: string;
    deposit: string; paid: string;
  }>(
    `SELECT b.branch_id,'booking' AS visit_type,b.id AS visit_record_id,b.customer_id,
       concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
       b.service_name,concat_ws(' ',br.first_name,br.last_name) AS barber_name,b.service_price AS service_price,
       CASE WHEN b.deposit_status='received' THEN b.deposit_amount ELSE 0 END AS deposit, ${bookingPaidSql} AS paid,
       b.updated_at AS completed_at
     FROM bookings b JOIN customers c ON c.id=b.customer_id
     LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=b.barber_id
     WHERE b.status='completed' AND ($1::integer[] IS NULL OR b.branch_id=ANY($1)) AND NOT EXISTS
       (SELECT 1 FROM transactions t WHERE t.visit_type='booking' AND t.visit_record_id=b.id)
       AND NOT EXISTS (SELECT 1 FROM visit_voids v WHERE v.visit_type='booking' AND v.visit_record_id=b.id)
     UNION ALL
     SELECT q.branch_id,'queue' AS visit_type,q.id AS visit_record_id,q.customer_id,
       concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
       q.service_name_snapshot AS service_name,concat_ws(' ',br.first_name,br.last_name) AS barber_name,
       q.service_price_snapshot AS service_price,0 AS deposit,${queuePaidSql} AS paid,q.completed_at
     FROM queue_entries q JOIN customers c ON c.id=q.customer_id
     LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=q.barber_id
     WHERE q.status='completed' AND ($1::integer[] IS NULL OR q.branch_id=ANY($1)) AND q.booking_id IS NULL AND NOT EXISTS
       (SELECT 1 FROM transactions t WHERE t.visit_type='queue' AND t.visit_record_id=q.id)
       AND NOT EXISTS (SELECT 1 FROM visit_voids v WHERE v.visit_type='queue' AND v.visit_record_id=q.id)
     ORDER BY completed_at DESC,visit_record_id DESC`, [branchIds ?? null],
  );
  return result.rows.map((row) => {
    const price = Number(row.service_price);
    const paid = Math.min(price, Number(row.paid));
    return { branchId: Number(row.branch_id), visitType: row.visit_type, visitRecordId: Number(row.visit_record_id),
      customerId: Number(row.customer_id), customerName: row.customer_name, serviceName: row.service_name, barberName: row.barber_name,
      servicePrice: price, total: price, deposit: Number(row.deposit), paid,
      balance: Math.round((price - paid) * 100) / 100 };
  });
}

type VisitRef = { bookingId: number } | { queueEntryId: number };
type LockedVisit = VisitRow & { paid: string; last_method: PaymentMethod | null };

// Lock one completed, still-unpaid visit and read what is owed on it.
async function lockVisit(client: import("pg").PoolClient, ref: VisitRef): Promise<LockedVisit> {
  const bookingId = "bookingId" in ref ? ref.bookingId : null;
  const result = bookingId !== null
    ? await client.query<LockedVisit>(
      `SELECT b.branch_id,b.id AS booking_id, NULL::bigint AS queue_entry_id, b.customer_id, b.barber_id,
        b.service_id, b.service_name, b.service_price AS amount, b.status AS visit_status,
        concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
        concat_ws(' ',br.first_name,br.last_name) AS barber_name, ${bookingPaidSql} AS paid,
        COALESCE((SELECT pp.payment_method FROM visit_partial_payments pp WHERE pp.visit_type='booking' AND pp.visit_record_id=b.id ORDER BY pp.id DESC LIMIT 1),
          CASE WHEN b.deposit_status='received' THEN b.deposit_method END) AS last_method
       FROM bookings b JOIN customers c ON c.id=b.customer_id
       LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=b.barber_id
       WHERE b.id=$1 FOR UPDATE OF b`, [bookingId],
    )
    : await client.query<LockedVisit>(
      `SELECT q.branch_id,NULL::bigint AS booking_id, q.id AS queue_entry_id, q.customer_id, q.barber_id,
        q.service_id, q.service_name_snapshot AS service_name,
        q.service_price_snapshot AS amount, q.status AS visit_status,
        concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
        concat_ws(' ',br.first_name,br.last_name) AS barber_name, ${queuePaidSql} AS paid,
        (SELECT pp.payment_method FROM visit_partial_payments pp WHERE pp.visit_type='queue' AND pp.visit_record_id=q.id ORDER BY pp.id DESC LIMIT 1) AS last_method
       FROM queue_entries q JOIN customers c ON c.id=q.customer_id
       LEFT JOIN users cu ON cu.id=c.user_id LEFT JOIN barbers br ON br.id=q.barber_id
       WHERE q.id=$1 AND q.booking_id IS NULL FOR UPDATE OF q`, [(ref as { queueEntryId: number }).queueEntryId],
    );
  const visit = result.rows[0];
  if (!visit) throw new PaymentServiceError("not_found", "Visit not found");
  if (visit.visit_status !== "completed") throw new PaymentServiceError("invalid_state", "Only completed visits can be checked out");
  const visitType = visit.booking_id !== null ? "booking" : "queue";
  const recordId = visit.booking_id ?? visit.queue_entry_id;
  const closed = await client.query(
    `SELECT 1 FROM transactions WHERE visit_type=$1 AND visit_record_id=$2
     UNION ALL SELECT 1 FROM visit_voids WHERE visit_type=$1 AND visit_record_id=$2`, [visitType, recordId]);
  if (closed.rowCount) throw new PaymentServiceError("conflict", "A transaction already exists for this visit");
  return visit;
}

async function insertSale(client: import("pg").PoolClient, visit: LockedVisit, sale: {
  amountCents: number; priorCents: number; method: PaymentMethod; receivedCents: number | null;
  cashierId: number; cashierName: string; receiptGroup: string | null;
}): Promise<TransactionRow> {
  const amount = (sale.amountCents / 100).toFixed(2);
  const inserted = await client.query<TransactionRow>(
    `INSERT INTO transactions
      (customer_id,booking_id,queue_entry_id,visit_type,visit_record_id,barber_id,service_id,processed_by,
       customer_name,barber_name,cashier_name,service_name,amount,payment_method,status,branch_id,prior_paid,receipt_group)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',$15,$16,$17) RETURNING *`,
    [visit.customer_id, visit.booking_id, visit.queue_entry_id, visit.booking_id !== null ? "booking" : "queue",
      visit.booking_id ?? visit.queue_entry_id, visit.barber_id, visit.service_id, sale.cashierId,
      visit.customer_name, visit.barber_name, sale.cashierName,
      visit.service_name, amount, sale.method, visit.branch_id, (sale.priorCents / 100).toFixed(2), sale.receiptGroup],
  );
  const transaction = inserted.rows[0];
  // Cash tenders must cover the sale: earlier payments count toward it, and
  // anything above the sale amount is the change handed back.
  const received = sale.receivedCents === null ? null : (sale.receivedCents / 100).toFixed(2);
  const change = sale.receivedCents === null ? null : ((sale.receivedCents - sale.amountCents) / 100).toFixed(2);
  await client.query(
    `INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,amount_received,change_amount)
     VALUES ($1,$2,$3,'completed',$4,$5)`,
    [transaction.id, sale.method, amount, received, change],
  );
  return { ...transaction, amount_received: received, change_amount: change };
}

export type CheckoutResult =
  | { kind: "paid"; transaction: TransactionRecord }
  // Underpayment: the money is recorded, the visit stays unpaid.
  | { kind: "partial"; customerName: string; serviceName: string; received: number; paid: number; total: number; balance: number };

// Full payment only, as before: an amount below the balance is refused.
export async function createTransaction(db: Pool, input: CreateTransactionInput, cashierId: number): Promise<TransactionRecord> {
  const result = await checkoutVisits(db, input, cashierId, false);
  if (result.kind !== "paid") throw new Error("Unexpected partial payment");
  return result.transaction;
}

// Checkout used by the Payments screen. With allowPartial, an amount below the
// balance is kept as a partial payment and the visit stays unpaid.
export async function checkoutVisits(db: Pool, input: CreateTransactionInput, cashierId: number, allowPartial = true): Promise<CheckoutResult> {
  const refs: VisitRef[] = "visits" in input && input.visits ? input.visits : [input.visit!];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cashier = await client.query<{ name: string; role: UserRole }>(
      `SELECT concat_ws(' ',u.first_name,u.last_name) AS name,r.name AS role FROM users u
       JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.deleted_at IS NULL
       AND u.is_verified=TRUE AND u.is_blocked=FALSE
       AND r.name IN ('administrator','manager','front_desk') FOR SHARE OF u`, [cashierId],
    );
    if (!cashier.rows[0]) throw new PaymentServiceError("forbidden", "A current staff account is required");

    const visits: LockedVisit[] = [];
    for (const ref of refs) {
      const visit = await lockVisit(client, ref);
      if (!await checkBranchAccess(client, { id: cashierId, role: cashier.rows[0].role }, Number(visit.branch_id)))
        throw new PaymentServiceError("forbidden", "You do not have access to this visit branch");
      visits.push(visit);
    }
    // One receipt belongs to one customer at one branch.
    if (visits.some((visit) => visit.customer_id !== visits[0].customer_id || visit.branch_id !== visits[0].branch_id))
      throw new PaymentServiceError("invalid_state", "Services on one receipt must belong to the same customer and branch");

    const lines = visits.map((visit) => {
      const amountCents = Math.round(Number(visit.amount) * 100);
      const priorCents = Math.min(amountCents, Math.round(Number(visit.paid) * 100));
      return { visit, amountCents, priorCents, dueCents: amountCents - priorCents };
    });
    const balanceCents = lines.reduce((sum, line) => sum + line.dueCents, 0);
    const receivedCents = input.amountReceived === undefined ? balanceCents : Math.round(input.amountReceived * 100);
    if (input.paymentMethod !== "cash" && receivedCents > balanceCents)
      throw new PaymentServiceError("invalid_state", "The amount cannot be more than the balance due");

    if (receivedCents < balanceCents) {
      // Underpayment: keep the money on record and leave the visit unpaid.
      if (!allowPartial) throw new PaymentServiceError("insufficient_cash", "Cash received is below the amount due");
      if (lines.length > 1) throw new PaymentServiceError("insufficient_cash", "A partial payment covers one service at a time. Select a single visit");
      if (receivedCents <= 0) throw new PaymentServiceError("insufficient_cash", "Enter the amount received");
      const [line] = lines;
      await client.query(
        `INSERT INTO visit_partial_payments(visit_type,visit_record_id,branch_id,amount,payment_method,received_by,received_by_name)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [line.visit.booking_id !== null ? "booking" : "queue", line.visit.booking_id ?? line.visit.queue_entry_id,
          line.visit.branch_id, (receivedCents / 100).toFixed(2), input.paymentMethod, cashierId, cashier.rows[0].name]);
      await client.query("COMMIT");
      return { kind: "partial", customerName: line.visit.customer_name, serviceName: line.visit.service_name,
        received: receivedCents / 100, paid: (line.priorCents + receivedCents) / 100,
        total: line.amountCents / 100, balance: (balanceCents - receivedCents) / 100 };
    }

    const receiptGroup = lines.length > 1
      ? (await client.query<{ ref: string }>("SELECT 'RC-' || upper(replace(gen_random_uuid()::text,'-','')) AS ref")).rows[0].ref
      : null;
    const overpaidCents = receivedCents - balanceCents;
    let first: TransactionRow | null = null;
    for (const [index, line] of lines.entries()) {
      // Any change is recorded on the last line of the receipt.
      const extra = index === lines.length - 1 ? overpaidCents : 0;
      const row = await insertSale(client, line.visit, {
        amountCents: line.amountCents, priorCents: line.priorCents, method: input.paymentMethod,
        receivedCents: input.paymentMethod === "cash" ? line.amountCents + extra : null,
        cashierId, cashierName: cashier.rows[0].name, receiptGroup,
      });
      first ??= row;
    }
    const transaction = await findTransactionByReference(client, first!.reference);
    if (!transaction) throw new Error("Created transaction missing");
    await client.query("COMMIT");
    return { kind: "paid", transaction };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      throw new PaymentServiceError("conflict", "A transaction already exists for this visit");
    }
    throw error;
  } finally {
    client.release();
  }
}

export type VisitVoidRecord = { visitType: "booking" | "queue"; visitRecordId: number; customerName: string; serviceName: string;
  amountDue: number; amountPaid: number; voidedAmount: number; reason: string; staffName: string; reference: string | null };

// Manager-only: close an unpaid or underpaid visit (underpayment, special
// price). The reason is required and logged; money already collected becomes a
// sale for exactly that amount so revenue stays truthful.
export async function voidVisitBalance(db: Pool, ref: VisitRef, reason: string, staffId: number): Promise<VisitVoidRecord> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const staff = await client.query<{ name: string; role: UserRole }>(
      `SELECT concat_ws(' ',u.first_name,u.last_name) AS name,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified=TRUE AND u.is_blocked=FALSE
       AND r.name IN ('administrator','manager') FOR SHARE OF u`, [staffId]);
    if (!staff.rows[0]) throw new PaymentServiceError("forbidden", "Manager access is required to void");
    const visit = await lockVisit(client, ref);
    if (!await checkBranchAccess(client, { id: staffId, role: staff.rows[0].role }, Number(visit.branch_id)))
      throw new PaymentServiceError("forbidden", "You do not have access to this visit branch");
    const dueCents = Math.round(Number(visit.amount) * 100);
    const paidCents = Math.min(dueCents, Math.round(Number(visit.paid) * 100));
    if (paidCents >= dueCents) throw new PaymentServiceError("invalid_state", "This visit has no remaining balance to void");
    const visitType = visit.booking_id !== null ? "booking" : "queue";
    const recordId = Number(visit.booking_id ?? visit.queue_entry_id);
    await client.query(
      `INSERT INTO visit_voids(visit_type,visit_record_id,branch_id,customer_name,service_name,amount_due,amount_paid,voided_amount,reason,staff_id,staff_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [visitType, recordId, visit.branch_id, visit.customer_name, visit.service_name, (dueCents / 100).toFixed(2),
        (paidCents / 100).toFixed(2), ((dueCents - paidCents) / 100).toFixed(2), reason, staffId, staff.rows[0].name]);
    let reference: string | null = null;
    if (paidCents > 0) {
      const method = visit.last_method ?? "other";
      const row = await insertSale(client, visit, {
        amountCents: paidCents, priorCents: paidCents, method,
        receivedCents: method === "cash" ? paidCents : null,
        cashierId: staffId, cashierName: staff.rows[0].name, receiptGroup: null,
      });
      reference = row.reference;
    }
    await client.query("COMMIT");
    return { visitType, visitRecordId: recordId, customerName: visit.customer_name, serviceName: visit.service_name,
      amountDue: dueCents / 100, amountPaid: paidCents / 100, voidedAmount: (dueCents - paidCents) / 100,
      reason, staffName: staff.rows[0].name, reference };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505")
      throw new PaymentServiceError("conflict", "This visit has already been paid or voided");
    throw error;
  } finally { client.release(); }
}
