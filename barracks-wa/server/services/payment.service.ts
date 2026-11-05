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
  actions?: FinancialActionRow[] | null;
};

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
};

export type EligibleVisit = {
  branchId: number;
  visitType: "booking" | "queue"; visitRecordId: number;
  customerName: string; serviceName: string; barberName: string; servicePrice: number; total: number;
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
  };
}

export async function findTransactionByReference(db: Db, reference: string, branchIds?: number[]): Promise<TransactionRecord | null> {
  const result = await db.query<TransactionRow>(
    `SELECT t.*,p.amount_received,p.change_amount,
       (SELECT json_agg(a ORDER BY a.created_at,a.id) FROM transaction_financial_actions a WHERE a.transaction_id=t.id) AS actions
     FROM transactions t JOIN transaction_payments p ON p.transaction_id=t.id WHERE t.reference=$1 AND ($2::integer[] IS NULL OR t.branch_id=ANY($2))`, [reference, branchIds ?? null]);
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
    if (transaction.status !== "completed") throw new PaymentServiceError("invalid_state", "Only a completed, unreversed transaction can be refunded or voided");
    if (input.action === "void") {
      const qualifying = await client.query(`SELECT 1 FROM payroll_service_snapshots s JOIN transactions t
        ON t.visit_type=s.visit_type AND t.visit_record_id=s.visit_record_id WHERE t.id=$1`, [transaction.id]);
      if (qualifying.rowCount) throw new PaymentServiceError("invalid_state", "Post-payment void policy is unconfirmed. Use the refund workflow, which retains earned commission.");
    }
    if (Math.round(input.amount * 100) !== Math.round(Number(transaction.amount) * 100)) {
      throw new PaymentServiceError("invalid_state", "Action amount must equal the full paid amount");
    }
    const status = input.action === "refund" ? "refunded" : "voided";
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

export async function listEligibleVisits(db: Pool, branchIds?: number[]): Promise<EligibleVisit[]> {
  const result = await db.query<{
    branch_id: number; visit_type: "booking" | "queue"; visit_record_id: string;
    customer_name: string; service_name: string; barber_name: string; service_price: string;
  }>(
    `SELECT b.branch_id,'booking' AS visit_type,b.id AS visit_record_id,
       concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
       b.service_name,concat_ws(' ',br.first_name,br.last_name) AS barber_name,b.service_price AS service_price,
       b.updated_at AS completed_at
     FROM bookings b JOIN customers c ON c.id=b.customer_id
     LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=b.barber_id
     WHERE b.status='completed' AND ($1::integer[] IS NULL OR b.branch_id=ANY($1)) AND NOT EXISTS
       (SELECT 1 FROM transactions t WHERE t.visit_type='booking' AND t.visit_record_id=b.id)
     UNION ALL
     SELECT q.branch_id,'queue' AS visit_type,q.id AS visit_record_id,
       concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
       q.service_name_snapshot AS service_name,concat_ws(' ',br.first_name,br.last_name) AS barber_name,
       q.service_price_snapshot AS service_price,q.completed_at
     FROM queue_entries q JOIN customers c ON c.id=q.customer_id
     LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=q.barber_id
     WHERE q.status='completed' AND ($1::integer[] IS NULL OR q.branch_id=ANY($1)) AND q.booking_id IS NULL AND NOT EXISTS
       (SELECT 1 FROM transactions t WHERE t.visit_type='queue' AND t.visit_record_id=q.id)
     ORDER BY completed_at DESC,visit_record_id DESC`, [branchIds ?? null],
  );
  return result.rows.map((row) => ({ branchId: Number(row.branch_id), visitType: row.visit_type, visitRecordId: Number(row.visit_record_id),
    customerName: row.customer_name, serviceName: row.service_name, barberName: row.barber_name,
    servicePrice: Number(row.service_price), total: Number(row.service_price) }));
}

export async function createTransaction(db: Pool, input: CreateTransactionInput, cashierId: number): Promise<TransactionRecord> {
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

    const bookingId = "bookingId" in input.visit ? input.visit.bookingId : null;
    const queueEntryId = "queueEntryId" in input.visit ? input.visit.queueEntryId : null;
    const result = bookingId !== null
      ? await client.query<VisitRow>(
        `SELECT b.branch_id,b.id AS booking_id, NULL::bigint AS queue_entry_id, b.customer_id, b.barber_id,
          b.service_id, b.service_name, b.service_price AS amount, b.status AS visit_status,
          concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
          concat_ws(' ',br.first_name,br.last_name) AS barber_name
         FROM bookings b JOIN customers c ON c.id=b.customer_id
         LEFT JOIN users cu ON cu.id=c.user_id JOIN barbers br ON br.id=b.barber_id
         WHERE b.id=$1 FOR UPDATE OF b`, [bookingId],
      )
      : await client.query<VisitRow>(
        `SELECT q.branch_id,NULL::bigint AS booking_id, q.id AS queue_entry_id, q.customer_id, q.barber_id,
          q.service_id, q.service_name_snapshot AS service_name,
          q.service_price_snapshot AS amount, q.status AS visit_status,
          concat_ws(' ',COALESCE(cu.first_name,c.first_name),COALESCE(cu.last_name,c.last_name)) AS customer_name,
          concat_ws(' ',br.first_name,br.last_name) AS barber_name
         FROM queue_entries q JOIN customers c ON c.id=q.customer_id
         LEFT JOIN users cu ON cu.id=c.user_id LEFT JOIN barbers br ON br.id=q.barber_id
         WHERE q.id=$1 AND q.booking_id IS NULL FOR UPDATE OF q`, [queueEntryId],
      );
    const visit = result.rows[0];
    if (!visit) throw new PaymentServiceError("not_found", "Visit not found");
    if (!await checkBranchAccess(client, { id: cashierId, role: cashier.rows[0].role }, Number(visit.branch_id)))
      throw new PaymentServiceError("forbidden", "You do not have access to this visit branch");
    if (visit.visit_status !== "completed") throw new PaymentServiceError("invalid_state", "Only completed visits can be checked out");

    const totalCents = Math.round(Number(visit.amount) * 100);
    const receivedCents = input.paymentMethod === "cash" ? Math.round(input.amountReceived * 100) : null;
    if (receivedCents !== null && receivedCents < totalCents) {
      throw new PaymentServiceError("insufficient_cash", "Cash received is below the amount due");
    }
    const amountReceived = receivedCents === null ? null : (receivedCents / 100).toFixed(2);
    const change = receivedCents === null ? null : ((receivedCents - totalCents) / 100).toFixed(2);

    const inserted = await client.query<TransactionRow>(
      `INSERT INTO transactions
        (customer_id,booking_id,queue_entry_id,visit_type,visit_record_id,barber_id,service_id,processed_by,
         customer_name,barber_name,cashier_name,service_name,amount,payment_method,status,branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',$15) RETURNING *`,
      [visit.customer_id, visit.booking_id, visit.queue_entry_id, bookingId !== null ? "booking" : "queue",
        bookingId ?? queueEntryId, visit.barber_id, visit.service_id, cashierId,
        visit.customer_name, visit.barber_name, cashier.rows[0].name,
        visit.service_name, visit.amount, input.paymentMethod, visit.branch_id],
    );
    const transaction = inserted.rows[0];
    await client.query(
      `INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,amount_received,change_amount)
       VALUES ($1,$2,$3,'completed',$4,$5)`,
      [transaction.id, input.paymentMethod, visit.amount, amountReceived, change],
    );
    await client.query("COMMIT");
    return toTransaction({ ...transaction, amount_received: amountReceived, change_amount: change });
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
