import assert from "node:assert/strict";
import test from "node:test";
import { financialActionSchema } from "@/server/schemas/payment.schema";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

test("financial action requests require a reason and valid full-cent amount", () => {
  assert.equal(financialActionSchema.safeParse({ action: "void", amount: 300, reason: "  customer request  " }).success, true);
  for (const amount of [0, -1, 300.001, 10_000_000_000])
    assert.equal(financialActionSchema.safeParse({ action: "void", amount, reason: "Requested" }).success, false);
  assert.equal(financialActionSchema.safeParse({ action: "void", amount: 300, reason: " " }).success, false);
});

test("void preserves sales and audit history and is limited to management", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  const { createTransaction, applyFinancialAction, findTransactionByReference, listTransactionHistory, PaymentServiceError } = await import("@/server/services/payment.service");
  try {
    const ids: Record<string, number> = {};
    for (const role of ["administrator", "manager", "front_desk", "supplier"]) {
      ids[role] = Number((await db.query<{ id: number }>(
        `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
         VALUES($1,'Operator',$2,'hash',(SELECT id FROM roles WHERE name=$3)) RETURNING id`,
        [role, `${role}-actions@test.local`, role])).rows[0].id);
    }
    await db.query("INSERT INTO user_branches(user_id,branch_id) SELECT $1,id FROM branches WHERE code='MAIN'", [ids.manager]);
    const customer = Number((await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Payment','Client') RETURNING id")).rows[0].id);
    const barber = Number((await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Payment','Barber') RETURNING id")).rows[0].id);
    const pay = async (time: string) => {
      const booking = Number((await db.query<{ id: number }>(
        `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
         VALUES($1,$2,'barracks-basic','Original service',300,'2026-09-20',$3,'completed') RETURNING id`, [customer, barber, time])).rows[0].id);
      return createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 500 }, ids.manager);
    };
    const refunded = await pay("10:00");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 300, reason: "Desk error" }, ids.front_desk),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 300, reason: "Desk error" }, ids.supplier),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 301, reason: "Too much" }, ids.manager),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 299, reason: "Partial" }, ids.manager),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    const afterRefund = await applyFinancialAction(db, refunded.reference, { action: "void", amount: 300, reason: "Customer request" }, ids.manager);
    assert.equal(afterRefund.status, "voided");
    assert.deepEqual(afterRefund.actions?.map((action) => [action.transactionId, action.action, action.amount, action.reason, action.staffId, action.staffName]),
      [[refunded.id, "void", 300, "Customer request", ids.manager, "manager Operator"]]);
    assert.ok(afterRefund.actions?.[0].createdAt);
    assert.equal(afterRefund.amountReceived, 500);
    assert.equal(afterRefund.change, 200);
    assert.equal(afterRefund.serviceName, "Original service");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 300, reason: "Again" }, ids.manager),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    await assert.rejects(applyFinancialAction(db, refunded.reference, { action: "void", amount: 300, reason: "Again" }, ids.manager),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    const retained = await pay("11:00");
    const unchanged = await findTransactionByReference(db, retained.reference);
    assert.equal(unchanged?.status, "completed");
    assert.equal(unchanged?.paymentStatus, "completed");
    assert.equal(unchanged?.amountReceived, 500);
    assert.equal(unchanged?.change, 200);
    assert.equal(unchanged?.actions, undefined);
    assert.equal(Number((await db.query("SELECT count(*) FROM transaction_financial_actions WHERE transaction_id=$1", [retained.id])).rows[0].count), 0);
    assert.equal((await findTransactionByReference(db, refunded.reference))?.status, "voided");
    const history = await listTransactionHistory(db, { page: 1, pageSize: 20, search: "" });
    assert.deepEqual(new Set(history.transactions.map((row) => row.status)), new Set(["voided", "completed"]));
    assert.equal(Number((await db.query("SELECT count(*) FROM transaction_financial_actions")).rows[0].count), 1);
    await assert.rejects(db.query("UPDATE transactions SET amount=1 WHERE id=$1", [refunded.id]), { constraint: "finalized_financial_record_immutable" });
    await assert.rejects(db.query("UPDATE transaction_payments SET amount_received=501 WHERE transaction_id=$1", [refunded.id]), { constraint: "finalized_financial_record_immutable" });
    await assert.rejects(db.query("DELETE FROM transactions WHERE id=$1", [refunded.id]), { constraint: "finalized_financial_record_immutable" });
    await assert.rejects(db.query("UPDATE transaction_financial_actions SET reason='changed' WHERE transaction_id=$1", [refunded.id]), { constraint: "financial_action_immutable" });
  } finally { await cleanup(); }
});

test("concurrent voids serialize and a failed status write rolls back the audit action", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  const { createTransaction, applyFinancialAction, findTransactionByReference } = await import("@/server/services/payment.service");
  try {
    const staff = Number((await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Audit','Manager','audit-manager@test.local','hash',(SELECT id FROM roles WHERE name='manager')) RETURNING id`)).rows[0].id);
    await db.query("INSERT INTO user_branches(user_id,branch_id) SELECT $1,id FROM branches WHERE code='MAIN'", [staff]);
    const customer = Number((await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Audit','Client') RETURNING id")).rows[0].id);
    const barber = Number((await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Audit','Barber') RETURNING id")).rows[0].id);
    const pay = async (time: string) => {
      const booking = Number((await db.query<{ id: number }>(
        `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
         VALUES($1,$2,'barracks-basic','Original',300,'2026-09-20',$3,'completed') RETURNING id`, [customer, barber, time])).rows[0].id);
      return createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "card" }, staff);
    };
    const sale = await pay("10:00");
    const attempts = await Promise.allSettled([1, 2].map(() => applyFinancialAction(db, sale.reference, { action: "void", amount: 300, reason: "Concurrent" }, staff)));
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    assert.equal(Number((await db.query("SELECT count(*) FROM transaction_financial_actions WHERE transaction_id=$1", [sale.id])).rows[0].count), 1);
    const second = await pay("11:00");
    await db.query(`CREATE FUNCTION fail_tender_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'forced failure'; END; $$`);
    await db.query(`CREATE TRIGGER fail_tender_action BEFORE UPDATE ON transaction_payments
      FOR EACH ROW EXECUTE FUNCTION fail_tender_action()`);
    await assert.rejects(applyFinancialAction(db, second.reference, { action: "void", amount: 300, reason: "Rollback" }, staff), /forced failure/);
    assert.equal((await findTransactionByReference(db, second.reference))?.status, "completed");
    assert.equal(Number((await db.query("SELECT count(*) FROM transaction_financial_actions WHERE transaction_id=$1", [second.id])).rows[0].count), 0);
  } finally { await cleanup(); }
});
