import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { createTransactionSchema, transactionHistorySchema } from "@/server/schemas/payment.schema";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { applyMigrations } from "@/server/db/migrate";

test("payment request accepts one visit and a supported method only", () => {
  assert.equal(createTransactionSchema.safeParse({ visit: { bookingId: 1 }, paymentMethod: "cash", amountReceived: 425 }).success, true);
  assert.equal(createTransactionSchema.safeParse({ visit: { queueEntryId: 2 }, paymentMethod: "e_wallet" }).success, true);
  for (const input of [
    { visit: { bookingId: 1 }, paymentMethod: "card", branchId: 99 },
    { visit: { bookingId: 1, queueEntryId: 2 }, paymentMethod: "cash", amountReceived: 1000 },
    { visit: { bookingId: 1 }, paymentMethod: "crypto" },
    { visit: { bookingId: 1 }, paymentMethod: "cash", amount: 0 },
    { visit: { bookingId: 1 }, paymentMethod: "cash", amountReceived: -1 },
    { visit: { bookingId: 1 }, paymentMethod: "cash", amountReceived: 1.001 },
    { visit: { bookingId: 1 }, visits: [{ bookingId: 1 }], paymentMethod: "card" },
    { visits: [], paymentMethod: "card" },
    { paymentMethod: "card" },
  ]) assert.equal(createTransactionSchema.safeParse(input).success, false);
  // Several visits of one customer can share a receipt, and a non-cash amount
  // below the balance records a partial payment.
  assert.equal(createTransactionSchema.safeParse({ visits: [{ queueEntryId: 2 }, { queueEntryId: 3 }], paymentMethod: "cash", amountReceived: 600 }).success, true);
  assert.equal(createTransactionSchema.safeParse({ visit: { bookingId: 1 }, paymentMethod: "card", amountReceived: 100 }).success, true);
});

test("transaction history filters validate paging, method and Manila date range", () => {
  assert.deepEqual(transactionHistorySchema.parse({}), { page: 1, pageSize: 20, search: "" });
  assert.equal(transactionHistorySchema.safeParse({ page: "2", pageSize: "100", search: " Ava ", paymentMethod: "cash", dateFrom: "2026-09-01", dateTo: "2026-09-29" }).success, true);
  for (const value of [{ page: "0" }, { pageSize: "101" }, { paymentMethod: "crypto" },
    { dateFrom: "2026-02-30" }, { dateFrom: "2026-09-30", dateTo: "2026-09-01" }]) {
    assert.equal(transactionHistorySchema.safeParse(value).success, false);
  }
});

test("completed bookings and walk-ins create unique snapshotted payments", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  const { createTransaction, findTransactionByReference, listEligibleVisits, listTransactions, listTransactionHistory, PaymentServiceError } = await import("@/server/services/payment.service");
  const { addWalkIn } = await import("@/server/services/queue.service");
  try {
    const staff = (await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Pat','Cashier','cashier@test.local','hash',(SELECT id FROM roles WHERE name='front_desk')) RETURNING id`,
    )).rows[0].id;
    await db.query("INSERT INTO user_branches(user_id,branch_id) SELECT $1,id FROM branches WHERE code='MAIN'", [staff]);
    const customerUser = (await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Ava','Client','client@test.local','hash',(SELECT id FROM roles WHERE name='customer')) RETURNING id`,
    )).rows[0].id;
    const customer = (await db.query<{ id: number }>("INSERT INTO customers(user_id) VALUES($1) RETURNING id", [customerUser])).rows[0].id;
    const walkIn = (await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Will','Walkin') RETURNING id")).rows[0].id;
    const barber = (await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Bea','Barber') RETURNING id")).rows[0].id;
    const booking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Original cut',425,'2026-09-20','09:00','completed') RETURNING id`, [customer, barber],
    )).rows[0].id;
    const walkInEntry = await addWalkIn(db, { customerId: walkIn, serviceId: "barracks-basic" });
    const entry = walkInEntry.id;
    assert.equal(walkInEntry.status, "waiting");
    assert.equal(Number((await db.query<{ service_price_snapshot: string }>(
      "SELECT service_price_snapshot FROM queue_entries WHERE id=$1", [entry],
    )).rows[0].service_price_snapshot), 300);
    await assert.rejects(db.query("UPDATE queue_entries SET service_price_snapshot=1 WHERE id=$1", [entry]), {
      code: "23514", constraint: "queue_entries_service_snapshot_immutable",
    });

    const linkedBooking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Linked appointment snapshot',475,'2026-09-20','10:00','confirmed') RETURNING id`,
      [walkIn, barber],
    )).rows[0].id;
    const linkedEntry = (await db.query<{ id: number; service_id: string; service_name_snapshot: string; service_price_snapshot: string }>(
      `INSERT INTO queue_entries(booking_id,customer_id,service_id,barber_id,status)
       VALUES($1,$2,'signature-shave',$3,'ready')
       RETURNING id,service_id,service_name_snapshot,service_price_snapshot`,
      [linkedBooking, walkIn, barber],
    )).rows[0];
    assert.equal(linkedEntry.service_id, "barracks-basic");
    assert.equal(linkedEntry.service_name_snapshot, "Linked appointment snapshot");
    assert.equal(Number(linkedEntry.service_price_snapshot), 475);

    await assert.rejects(createTransaction(db, { visit: { bookingId: 999999 }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "not_found");
    await assert.rejects(createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 1000 }, customerUser),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await assert.rejects(createTransaction(db, { visit: { queueEntryId: Number(linkedEntry.id) }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "not_found");
    await assert.rejects(createTransaction(db, { visit: { queueEntryId: entry }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    await assert.rejects(createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 424.99 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "insufficient_cash");
    assert.equal(Number((await db.query<{ count: string }>("SELECT count(*) FROM transactions WHERE booking_id=$1", [booking])).rows[0].count), 0);
    assert.deepEqual((await listEligibleVisits(db)).map((visit) => [visit.visitType, visit.visitRecordId, visit.servicePrice]), [["booking", Number(booking), 425]]);

    await db.query("UPDATE users SET is_blocked=TRUE WHERE id=$1", [staff]);
    await assert.rejects(createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await db.query("UPDATE users SET is_blocked=FALSE,is_verified=FALSE WHERE id=$1", [staff]);
    await assert.rejects(createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await db.query("UPDATE users SET is_verified=TRUE WHERE id=$1", [staff]);

    const bookingPayment = await createTransaction(db, { visit: { bookingId: booking }, paymentMethod: "card" }, staff);
    assert.equal(bookingPayment.amount, 425);
    assert.equal(bookingPayment.serviceName, "Original cut");
    assert.equal(bookingPayment.customerName, "Ava Client");
    assert.equal(bookingPayment.cashierName, "Pat Cashier");
    assert.equal(bookingPayment.subtotal, 425);
    assert.equal(bookingPayment.total, 425);
    assert.equal(bookingPayment.amountReceived, null);
    assert.equal(bookingPayment.change, null);
    assert.equal(bookingPayment.paymentStatus, "completed");
    assert.ok(!Number.isNaN(Date.parse(bookingPayment.createdAt)));
    assert.match(bookingPayment.reference, /^TX-[A-F0-9]{32}$/);
    assert.equal((await listEligibleVisits(db)).some((visit) => visit.visitRecordId === Number(booking) && visit.visitType === "booking"), false);
    assert.equal((await listTransactions(db))[0].reference, bookingPayment.reference);

    await db.query("UPDATE services SET name='Changed after walk-in',current_price=999 WHERE id='barracks-basic'");
    await db.query("UPDATE queue_entries SET barber_id=$2,status='ready' WHERE id=$1", [entry, barber]);
    await db.query("UPDATE queue_entries SET status='in_progress',started_at=NOW() WHERE id=$1", [entry]);
    await db.query("UPDATE queue_entries SET status='completed',completed_at=GREATEST(NOW(),started_at) WHERE id=$1", [entry]);
    await db.query("UPDATE services SET name='Changed after completion',current_price=1250 WHERE id='barracks-basic'");
    assert.deepEqual((await listEligibleVisits(db)).map((visit) => [visit.visitType, visit.visitRecordId, visit.servicePrice]), [["queue", Number(entry), 300]]);

    const concurrent = await Promise.allSettled([
      createTransaction(db, { visit: { queueEntryId: entry }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      createTransaction(db, { visit: { queueEntryId: entry }, paymentMethod: "cash", amountReceived: 1000 }, staff),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" &&
      result.reason instanceof PaymentServiceError && result.reason.kind === "conflict").length, 1);
    const walkInPayment = concurrent.find((result) => result.status === "fulfilled")!.value;
    assert.equal((await listEligibleVisits(db)).length, 0);
    assert.equal((await listTransactions(db)).length, 2);
    assert.equal(walkInPayment.customerName, "Will Walkin");
    assert.equal(walkInPayment.queueEntryId, Number(entry));
    assert.equal(walkInPayment.serviceName, "Barracks Basic");
    assert.equal(walkInPayment.amount, 300);
    assert.equal(walkInPayment.subtotal, 300);
    assert.equal(walkInPayment.total, 300);
    assert.equal(walkInPayment.amountReceived, 1000);
    assert.equal(walkInPayment.change, 700);
    assert.equal(walkInPayment.paymentMethod, "cash");
    await assert.rejects(createTransaction(db, { visit: { queueEntryId: entry }, paymentMethod: "cash", amountReceived: 1000 }, staff),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "conflict");

    await db.query("UPDATE users SET first_name='Changed' WHERE id=$1", [customerUser]);
    await db.query("UPDATE barbers SET first_name='Changed' WHERE id=$1", [barber]);
    const saved = await findTransactionByReference(db, bookingPayment.reference);
    assert.equal(saved?.customerName, "Ava Client");
    assert.equal(saved?.barberName, "Bea Barber");
    assert.equal(saved?.serviceName, "Original cut");
    assert.equal(saved?.amount, 425);
    assert.equal(saved?.amountReceived, null);
    const historyBase = { page: 1, pageSize: 1, search: "" };
    const firstPage = await listTransactionHistory(db, historyBase);
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.transactions[0].reference, walkInPayment.reference);
    assert.equal((await listTransactionHistory(db, { ...historyBase, page: 2 })).transactions[0].reference, bookingPayment.reference);
    const filtered = await listTransactionHistory(db, { ...historyBase, pageSize: 20, search: "ava", paymentMethod: "card" });
    assert.deepEqual(filtered.transactions.map((item) => [item.reference, item.serviceName, item.total]), [[bookingPayment.reference, "Original cut", 425]]);
    assert.equal((await listTransactionHistory(db, { ...historyBase, search: "no match" })).total, 0);
    assert.equal((await listTransactionHistory(db, { ...historyBase, search: bookingPayment.reference.slice(3, 11) })).transactions[0].reference, bookingPayment.reference);
    const manilaDate = new Date(bookingPayment.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    assert.equal((await listTransactionHistory(db, { ...historyBase, dateFrom: manilaDate, dateTo: manilaDate })).total, 2);
    assert.equal((await listTransactionHistory(db, { ...historyBase, paymentMethod: "bank_transfer" })).total, 0);
    assert.equal(Number((await db.query<{ count: string }>("SELECT count(*) FROM transaction_payments WHERE transaction_id=$1", [bookingPayment.id])).rows[0].count), 1);
    await assert.rejects(db.query("UPDATE transactions SET payment_method='bitcoin' WHERE id=$1", [bookingPayment.id]), { code: "23514" });
    await assert.rejects(db.query("UPDATE transactions SET payment_method='cash' WHERE id=$1", [bookingPayment.id]), {
      code: "23514", constraint: "finalized_financial_record_immutable",
    });
    await assert.rejects(db.query("UPDATE transactions SET amount=amount+1 WHERE id=$1", [bookingPayment.id]), {
      code: "23514", constraint: "finalized_financial_record_immutable",
    });
    await assert.rejects(db.query("UPDATE transactions SET visit_record_id=visit_record_id+1 WHERE id=$1", [bookingPayment.id]), {
      code: "23514", constraint: "finalized_financial_record_immutable",
    });
    await assert.rejects(db.query("UPDATE transaction_payments SET status='failed' WHERE transaction_id=$1", [bookingPayment.id]), {
      code: "23514", constraint: "finalized_financial_record_immutable",
    });
    await assert.rejects(db.query("DELETE FROM transaction_payments WHERE transaction_id=$1", [bookingPayment.id]), {
      code: "23514", constraint: "finalized_financial_record_immutable",
    });
    await assert.rejects(db.query(
      `INSERT INTO transactions(customer_id,booking_id,visit_type,visit_record_id,barber_id,service_id,amount,payment_method,status,customer_name,barber_name,service_name)
       VALUES($1,$2,'queue',$2,$3,'barracks-basic',425,'cash','completed','Ava Client','Bea Barber','Original cut')`,
      [customer, booking, barber],
    ), { code: "23514", constraint: "transactions_visit_identity_check" });
    await assert.rejects(db.query(
      `INSERT INTO transactions(customer_id,queue_entry_id,visit_type,visit_record_id,barber_id,service_id,amount,payment_method,status,customer_name,barber_name,service_name)
       VALUES($1,$2,'queue',$2,$3,'barracks-basic',475,'cash','completed','Will Walkin','Bea Barber','Linked appointment snapshot')`,
      [walkIn, linkedEntry.id, barber],
    ), { code: "23514", constraint: "transactions_visit_identity_check" });
    await db.query("DELETE FROM customers WHERE id=$1", [customer]);
    const afterDelete = await findTransactionByReference(db, bookingPayment.reference);
    assert.equal(afterDelete?.bookingId, null);
    assert.equal(afterDelete?.visitType, "booking");
    assert.equal(afterDelete?.visitRecordId, Number(booking));
    assert.equal(afterDelete?.customerName, "Ava Client");
  } finally {
    await cleanup();
  }
});

test("exact cash checkout uses the booking snapshot and persists a balanced tender", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema();
  const { createTransaction, findTransactionByReference, PaymentServiceError } = await import("@/server/services/payment.service");
  try {
    const cashier = (await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Cash','Desk','cash-desk@test.local','hash',(SELECT id FROM roles WHERE name='manager')) RETURNING id`,
    )).rows[0].id;
    await db.query("INSERT INTO user_branches(user_id,branch_id) SELECT $1,id FROM branches WHERE code='MAIN'", [cashier]);
    const supplier = (await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Supplier','User','supplier-payment@test.local','hash',(SELECT id FROM roles WHERE name='supplier')) RETURNING id`,
    )).rows[0].id;
    const customer = (await db.query<{ id: number }>(
      "INSERT INTO customers(first_name,last_name) VALUES('Exact','Customer') RETURNING id",
    )).rows[0].id;
    const barber = (await db.query<{ id: number }>(
      "INSERT INTO barbers(first_name,last_name) VALUES('Exact','Barber') RETURNING id",
    )).rows[0].id;
    const booking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Snapshot cut',425.25,'2026-09-20','12:00','confirmed') RETURNING id`,
      [customer, barber],
    )).rows[0].id;
    const request = { visit: { bookingId: booking }, paymentMethod: "cash" as const, amountReceived: 425.25 };
    await assert.rejects(createTransaction(db, request, cashier),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "invalid_state");
    await db.query("UPDATE bookings SET status='completed' WHERE id=$1", [booking]);
    await assert.rejects(createTransaction(db, request, supplier),
      (error: unknown) => error instanceof PaymentServiceError && error.kind === "forbidden");
    await db.query("UPDATE services SET current_price=900 WHERE id='barracks-basic'");
    const paid = await createTransaction(db, request, cashier);
    assert.equal(paid.subtotal, 425.25);
    assert.equal(paid.total, 425.25);
    assert.equal(paid.amountReceived, 425.25);
    assert.equal(paid.change, 0);
    assert.equal(paid.serviceName, "Snapshot cut");
    assert.equal(paid.cashierName, "Cash Desk");
    assert.equal(paid.paymentStatus, "completed");
    const saved = await findTransactionByReference(db, paid.reference);
    // Checkout returns the saved receipt, and a completed sale can be voided.
    assert.deepEqual(saved, paid);
    assert.equal(saved?.voidable, true);
    assert.equal(saved?.priorPaid, 0);
    assert.equal(saved?.tendered, 425.25);
    assert.deepEqual(saved?.lines?.map((line) => [line.serviceName, line.amount]), [["Snapshot cut", 425.25]]);
    const tender = (await db.query<{ amount: string; amount_received: string; change_amount: string }>(
      "SELECT amount,amount_received,change_amount FROM transaction_payments WHERE transaction_id=$1", [paid.id],
    )).rows[0];
    assert.equal(Number(tender.amount), 425.25);
    assert.equal(Number(tender.amount_received), 425.25);
    assert.equal(Number(tender.change_amount), 0);
    await assert.rejects(db.query(
      "UPDATE transaction_payments SET amount_received=400,change_amount=0 WHERE transaction_id=$1", [paid.id],
    ), { code: "23514", constraint: "finalized_financial_record_immutable" });
    const admin = (await db.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Admin','Cashier','admin-cashier@test.local','hash',(SELECT id FROM roles WHERE name='administrator')) RETURNING id`,
    )).rows[0].id;
    const secondBooking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Second cut',300,'2026-09-20','13:00','completed') RETURNING id`,
      [customer, barber],
    )).rows[0].id;
    const adminPayment = await createTransaction(db, { visit: { bookingId: secondBooking }, paymentMethod: "card" }, admin);
    assert.equal(adminPayment.cashierName, "Admin Cashier");
  } finally {
    await cleanup();
  }
});

test("migration backfills legacy transactions and retains unfamiliar historical values", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(16);
  try {
    const customer = (await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Old','Client') RETURNING id")).rows[0].id;
    const barber = (await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Old','Barber') RETURNING id")).rows[0].id;
    const booking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Old service',300,'2026-09-20','10:00','completed') RETURNING id`, [customer, barber],
    )).rows[0].id;
    const oldId = (await db.query<{ id: string }>(
      "INSERT INTO transactions(customer_id,booking_id,barber_id,service_id,amount,payment_method,status) VALUES($1,$2,$3,'barracks-basic',300,'voucher','settled') RETURNING id",
      [customer, booking, barber],
    )).rows[0].id;
    await applyMigrations(db);
    const row = (await db.query<{
      reference: string; payment_method: string; status: string; legacy_payment_method: string;
      legacy_status: string; customer_name: string; service_name: string; visit_record_id: string;
    }>("SELECT * FROM transactions WHERE id=$1", [oldId])).rows[0];
    assert.equal(row.reference, `TX-LEGACY-${oldId}`);
    assert.equal(row.payment_method, "other");
    assert.equal(row.status, "unknown");
    assert.equal(row.legacy_payment_method, "voucher");
    assert.equal(row.legacy_status, "settled");
    assert.equal(row.customer_name, "Old Client");
    assert.equal(row.service_name, "Old service");
    assert.equal(Number(row.visit_record_id), Number(booking));
    assert.equal(Number((await db.query<{ count: string }>("SELECT count(*) FROM transaction_payments WHERE transaction_id=$1", [oldId])).rows[0].count), 1);
  } finally {
    await cleanup();
  }
});

test("migration 017 diagnoses duplicate booking transactions and rolls back atomically", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(16);
  try {
    const customer = (await db.query<{ id: number }>(
      "INSERT INTO customers(first_name,last_name) VALUES('Duplicate','Client') RETURNING id",
    )).rows[0].id;
    const barber = (await db.query<{ id: number }>(
      "INSERT INTO barbers(first_name,last_name) VALUES('Duplicate','Barber') RETURNING id",
    )).rows[0].id;
    const booking = (await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Duplicate service',300,'2026-09-20','11:00','completed') RETURNING id`, [customer, barber],
    )).rows[0].id;
    const transactionIds: number[] = [];
    for (let i = 0; i < 2; i++) transactionIds.push(Number((await db.query<{ id: string }>(
      `INSERT INTO transactions(customer_id,booking_id,barber_id,service_id,amount,payment_method,status)
       VALUES($1,$2,$3,'barracks-basic',300,'cash','completed') RETURNING id`, [customer, booking, barber],
    )).rows[0].id));

    let migrationError: unknown;
    try { await applyMigrations(db); }
    catch (error) { migrationError = error; }
    assert.ok(migrationError && typeof migrationError === "object");
    assert.equal((migrationError as { code?: string }).code, "23505");
    assert.match((migrationError as Error).message, /Migration 017 aborted/);
    assert.match((migrationError as Error).message, new RegExp(`booking_id=${booking}`));
    assert.match((migrationError as Error).message, new RegExp(`transaction_ids=\\[${transactionIds.join(", ")}\\]`));
    assert.match((migrationError as { hint?: string }).hint ?? "", /reconcile/i);
    assert.equal(Number((await db.query("SELECT count(*) FROM schema_migrations")).rows[0].count), 16);
    assert.equal(Number((await db.query(
      "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='transactions' AND column_name='reference'",
    )).rows[0].count), 0);
    assert.equal(Number((await db.query(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='transaction_payments'",
    )).rows[0].count), 0);
    assert.equal(Number((await db.query("SELECT count(*) FROM transactions WHERE booking_id=$1", [booking])).rows[0].count), 2);

    await db.query("DELETE FROM transactions WHERE id=$1", [transactionIds[1]]);
    await applyMigrations(db);
    const migrationFiles = (await readdir(new URL("../server/db/migrations/", import.meta.url))).filter((file) => /^\d+_.+\.sql$/.test(file));
    assert.equal(Number((await db.query("SELECT count(*) FROM schema_migrations")).rows[0].count), migrationFiles.length);
  } finally {
    await cleanup();
  }
});

test("Phase 4 Main Branch backfill preserves finalized sale, tender and refund audit history", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(24);
  try {
    const customer = Number((await db.query("INSERT INTO customers(first_name,last_name) VALUES('Historical','Payment') RETURNING id")).rows[0].id);
    const barber = Number((await db.query("INSERT INTO barbers(first_name,last_name) VALUES('Historical','Barber') RETURNING id")).rows[0].id);
    const booking = Number((await db.query("INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status) VALUES($1,$2,'barracks-basic','Historical cut',300,'2026-09-20','12:00','completed') RETURNING id", [customer, barber])).rows[0].id);
    const client = await db.connect();
    let id: number;
    try {
      await client.query("BEGIN");
      id = Number((await client.query("INSERT INTO transactions(booking_id,visit_type,visit_record_id,customer_name,barber_name,service_name,amount,payment_method,status) VALUES($1,'booking',$1,'Saved customer','Saved barber','Saved cut',300,'card','completed') RETURNING id", [booking])).rows[0].id);
      await client.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status) VALUES($1,'card',300,'completed')", [id]);
      await client.query("INSERT INTO transaction_financial_actions(transaction_id,action_type,amount,reason,staff_name) VALUES($1,'refund',300,'Historical refund','Saved manager')", [id]);
      await client.query("UPDATE transactions SET status='refunded' WHERE id=$1", [id]);
      await client.query("UPDATE transaction_payments SET status='refunded' WHERE transaction_id=$1", [id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const before = (await db.query("SELECT * FROM transactions WHERE id=$1", [id])).rows[0];
    const tenders = (await db.query("SELECT * FROM transaction_payments WHERE transaction_id=$1", [id])).rows;
    const actions = (await db.query("SELECT * FROM transaction_financial_actions WHERE transaction_id=$1", [id])).rows;
    await applyMigrations(db);
    const after = (await db.query("SELECT * FROM transactions WHERE id=$1", [id])).rows[0];
    assert.equal(after.branch_id, Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id));
    delete after.branch_id;
    // Migration 036 adds these with neutral defaults and leaves the sale untouched.
    assert.equal(after.prior_paid, "0.00");
    assert.equal(after.receipt_group, null);
    delete after.prior_paid;
    delete after.receipt_group;
    assert.deepEqual(after, before);
    assert.deepEqual((await db.query("SELECT * FROM transaction_payments WHERE transaction_id=$1", [id])).rows, tenders);
    assert.deepEqual((await db.query("SELECT * FROM transaction_financial_actions WHERE transaction_id=$1", [id])).rows, actions);
    await assert.rejects(db.query("UPDATE transactions SET amount=1 WHERE id=$1", [id]), { code: "23514", constraint: "finalized_financial_record_immutable" });
  } finally { await cleanup(); }
});
