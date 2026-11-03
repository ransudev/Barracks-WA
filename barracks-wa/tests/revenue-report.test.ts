import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getInventoryReport } from "@/server/services/inventory-report.service";
import { getDashboardReport } from "@/server/services/dashboard-report.service";
import { BranchError } from "@/server/services/branch.service";
import type { BranchActor } from "@/server/auth/branch-access";
import type { Pool } from "pg";
import { getRevenueReport, summarizeRevenueEvents } from "@/server/services/revenue-report.service";
import { applyMigrations } from "@/server/db/migrate";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";

const admin: BranchActor = { id: 0, role: "administrator" };
let apiDb: Pool;
let apiActor: BranchActor = admin;
mock.module("@/server/auth/session", { namedExports: { getCurrentUser: async () => apiActor } });
mock.module("@/server/db/pool", { namedExports: { pool: { query: (...args: Parameters<Pool["query"]>) => apiDb.query(...args) } } });

const range = { from: "2026-09-02", to: "2026-09-03" };

test("revenue totals and all groupings count each sale and action once", () => {
  const report = summarizeRevenueEvents(range, [
    { day: "2026-09-02", service_name: "Classic cut", barber_name: "Alex", payment_method: "cash", event_type: "sale", amount: "100.00", transaction_count: "1" },
    { day: "2026-09-02", service_name: "Classic cut", barber_name: "Alex", payment_method: "cash", event_type: "sale", amount: "50.25", transaction_count: "1" },
    { day: "2026-09-02", service_name: "Shave", barber_name: "Bea", payment_method: "card", event_type: "sale", amount: "200.00", transaction_count: "1" },
    { day: "2026-09-03", service_name: "Classic cut", barber_name: "Alex", payment_method: "cash", event_type: "void", amount: "50.25", transaction_count: "0" },
    { day: "2026-09-03", service_name: "Shave", barber_name: "Bea", payment_method: "card", event_type: "refund", amount: "200.00", transaction_count: "0" },
  ]);
  assert.deepEqual(report.summary, { grossSales: 350.25, refundedAmount: 200, voidedAmount: 50.25,
    reversedAmount: 250.25, netRevenue: 100, transactionCount: 3 });
  assert.deepEqual(report.dailySales.map(({ label, grossSales, reversedAmount, netRevenue, transactionCount }) =>
    [label, grossSales, reversedAmount, netRevenue, transactionCount]),
  [["2026-09-02", 350.25, 0, 350.25, 3], ["2026-09-03", 0, 250.25, -250.25, 0]]);
  assert.deepEqual(report.byService.map(({ label, netRevenue }) => [label, netRevenue]), [["Classic cut", 100], ["Shave", 0]]);
  assert.deepEqual(report.byBarber.map(({ label, netRevenue }) => [label, netRevenue]), [["Alex", 100], ["Bea", 0]]);
  assert.deepEqual(report.byPaymentMethod.map(({ label, netRevenue }) => [label, netRevenue]), [["cash", 100], ["card", 0]]);
});

test("zero-data reports return zero summary and empty breakdowns", () => {
  const report = summarizeRevenueEvents(range, []);
  assert.deepEqual(report.summary, { grossSales: 0, refundedAmount: 0, voidedAmount: 0,
    reversedAmount: 0, netRevenue: 0, transactionCount: 0 });
  assert.deepEqual([report.dailySales, report.byService, report.byBarber, report.byPaymentMethod], [[], [], [], []]);
});

test("report query uses inclusive Manila-local days and one event stream", async () => {
  let values: unknown[] = [];
  let sql = "";
  const db = { query: async (query: string, parameters: unknown[]) => {
    if (query.includes("FROM branches")) return { rows: [{ id: 1, created_at: new Date(), updated_at: new Date() }] };
    sql = query; values = parameters; return { rows: [] };
  } } as unknown as Pool;
  await getRevenueReport(db, range, admin);
  assert.deepEqual(values, ["2026-09-02T00:00:00+08:00", "2026-09-04T00:00:00+08:00", [1]]);
  assert.equal((sql.match(/t.branch_id=ANY/g) ?? []).length, 3);
  assert.match(sql, /transaction_financial_actions/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM transaction_financial_actions/);
  assert.match(sql, /Asia\/Manila/);
  assert.doesNotMatch(sql, /barbers\.revenue|JOIN transaction_payments/i);
});

test("pre-action reversed transactions are counted once using their transaction date", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(19);
  try {
    const customer = Number((await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Legacy','Customer') RETURNING id")).rows[0].id);
    const barber = Number((await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Legacy','Barber') RETURNING id")).rows[0].id);
    const booking = Number((await db.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Legacy cut',75,'2026-09-02','12:00','completed') RETURNING id`, [customer, barber])).rows[0].id);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const tx = Number((await client.query<{ id: string }>(
        `INSERT INTO transactions(customer_id,booking_id,visit_type,visit_record_id,barber_id,service_id,
          customer_name,barber_name,service_name,amount,payment_method,status,created_at)
         VALUES($1,$2,'booking',$2,$3,'barracks-basic','Legacy Customer','Legacy Barber','Legacy cut',75,'card','refunded','2026-09-02T08:00:00Z') RETURNING id`,
        [customer, booking, barber])).rows[0].id);
      await client.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status) VALUES($1,'card',75,'refunded')", [tx]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await applyMigrations(db);
    const report = await getRevenueReport(db, range, admin);
    assert.equal(report.summary.grossSales, 75);
    assert.equal(report.summary.refundedAmount, 75);
    assert.equal(report.summary.netRevenue, 0);
    assert.equal(report.summary.transactionCount, 1);
  } finally { await cleanup(); }
});

test("persisted report retains legacy sale snapshots and action dates across Manila midnight", { skip: !databaseConfigured }, async () => {
  // Legacy void actions predate payroll activation. New earned/snapshotted
  // sales cannot be voided under the current pending policy.
  const { db, cleanup } = await createDisposableSchema(27);
  try {
    const customer = Number((await db.query<{ id: number }>("INSERT INTO customers(first_name,last_name) VALUES('Report','Customer') RETURNING id")).rows[0].id);
    const barber = Number((await db.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Current','Barber') RETURNING id")).rows[0].id);
    const sale = async (time: string, amount: number, service: string, barberName: string, method: string) => {
      const client = await db.connect();
      try {
      await client.query("BEGIN");
      const booking = Number((await client.query<{ id: number }>(
        `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
         VALUES($1,$2,'barracks-basic',$3,$4,'2026-09-02','10:00','completed') RETURNING id`,
        [customer, barber, service, amount])).rows[0].id);
      const tx = Number((await client.query<{ id: string }>(
        `INSERT INTO transactions(customer_id,booking_id,visit_type,visit_record_id,barber_id,service_id,
           customer_name,barber_name,service_name,amount,payment_method,status,created_at)
         VALUES($1,$2,'booking',$2,$3,'barracks-basic','Report Customer',$4,$5,$6,$7,'completed',$8) RETURNING id`,
        [customer, booking, barber, barberName, service, amount, method, time])).rows[0].id);
      await client.query(`INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,amount_received,change_amount)
        VALUES($1,$2,$3,'completed',$4,$5)`, [tx, method, amount, method === "cash" ? amount : null, method === "cash" ? 0 : null]);
      await client.query("COMMIT");
      return tx;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    const old = await sale("2026-09-01T15:59:00Z", 100, "Original cut", "Former barber", "cash");
    const current = await sale("2026-09-01T16:00:00Z", 200, "Original shave", "Former barber", "card");
    const voided = await sale("2026-09-02T12:00:00Z", 50, "Original cut", "Other barber", "cash");
    await db.query("UPDATE barbers SET first_name='Renamed' WHERE id=$1", [barber]);
    await db.query("UPDATE services SET name='Renamed service' WHERE id='barracks-basic'");
    for (const [id, action, amount] of [[old, "refund", 100], [current, "refund", 200], [voided, "void", 50]] as const) {
      const client = await db.connect();
      try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO transaction_financial_actions(transaction_id,action_type,amount,reason,staff_name,created_at)
        VALUES($1,$2,$3,'Report test','Manager','2026-09-03T00:00:00+08:00')`, [id, action, amount]);
      await client.query("UPDATE transactions SET status=$2 WHERE id=$1", [id, action === "refund" ? "refunded" : "voided"]);
      await client.query("UPDATE transaction_payments SET status=$2 WHERE transaction_id=$1", [id, action === "refund" ? "refunded" : "voided"]);
      await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await applyMigrations(db);
    const report = await getRevenueReport(db, range, admin);
    assert.deepEqual(report.summary, { grossSales: 250, refundedAmount: 300, voidedAmount: 50,
      reversedAmount: 350, netRevenue: -100, transactionCount: 2 });
    assert.deepEqual(report.dailySales.map((row) => [row.label, row.grossSales, row.reversedAmount]),
      [["2026-09-02", 250, 0], ["2026-09-03", 0, 350]]);
    assert.deepEqual(report.byService.map((row) => row.label).sort(), ["Original cut", "Original shave"]);
    assert.deepEqual(report.byBarber.map((row) => row.label).sort(), ["Former barber", "Other barber"]);
    assert.deepEqual(report.byPaymentMethod.map((row) => row.label).sort(), ["card", "cash"]);
  } finally { await cleanup(); }
});

test("branch reports isolate ownership, aggregate once, and reject unauthorized scopes", { skip: !databaseConfigured }, async () => {
  // Exercise retained legacy void/refund evidence, then upgrade and prove
  // current branch reports still attribute that history to its source branch.
  const { db, cleanup } = await createDisposableSchema(27);
  apiDb = db;
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const other = Number((await db.query("INSERT INTO branches(name,code) VALUES('Second','SECOND') RETURNING id")).rows[0].id);
    const user = Number((await db.query(`INSERT INTO users(first_name,last_name,email,password_hash,role_id)
      SELECT 'Report','Manager','report.manager@test.local','hash',id FROM roles WHERE name='manager' RETURNING id`)).rows[0].id);
    const manager: BranchActor = { id: user, role: "manager" };
    await db.query("INSERT INTO user_branches(user_id,branch_id,is_primary) VALUES($1,$2,true)", [user, main]);
    const customer = Number((await db.query("INSERT INTO customers(first_name,last_name) VALUES('Shared','Customer') RETURNING id")).rows[0].id);
    const supplier = Number((await db.query("INSERT INTO suppliers(company_name) VALUES('Shared supplier') RETURNING id")).rows[0].id);
    const sales: number[] = [];
    const barbers: number[] = [];
    for (const [branch, amount, quantity] of [[main, 100, 2], [other, 300, 5]]) {
      const barber = Number((await db.query("INSERT INTO barbers(first_name,last_name,branch_id) VALUES('Report','Barber',$1) RETURNING id", [branch])).rows[0].id);
      barbers.push(barber);
      const booking = Number((await db.query(`INSERT INTO bookings(customer_id,barber_id,branch_id,service_id,service_name,service_price,booking_date,booking_time,status)
        VALUES($1,$2,$3,'barracks-basic','Saved cut',$4,(NOW() AT TIME ZONE 'Asia/Manila')::date,'10:00','completed') RETURNING id`, [customer, barber, branch, amount])).rows[0].id);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const tx = Number((await client.query(`INSERT INTO transactions(customer_id,booking_id,visit_type,visit_record_id,barber_id,branch_id,service_id,customer_name,barber_name,service_name,amount,payment_method,status,created_at)
          VALUES($1,$2,'booking',$2,$3,$4,'barracks-basic','Shared Customer','Saved Barber','Saved cut',$5,'cash','completed','2026-09-02T12:00:00+08:00') RETURNING id`, [customer, booking, barber, branch, amount])).rows[0].id);
        await client.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,amount_received,change_amount) VALUES($1,'cash',$2,'completed',$2,0)", [tx, amount]);
        await client.query("COMMIT"); sales.push(tx);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      const item = Number((await db.query(`INSERT INTO inventory_items(name,category,branch_id,quantity,unit_cost,supplier_id)
        VALUES('Same product','Products',$1,$2,10,$3) RETURNING id`, [branch, quantity, supplier])).rows[0].id);
      await db.query(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity,previous_stock,new_stock,created_by,created_at)
        VALUES($1,'USE',$2,10,8,$3,'2026-09-02T12:00:00Z')`, [item, quantity, user]);
      const restock = Number((await db.query(`INSERT INTO restock_requests(supplier_id,branch_id,status,requested_by,received_by,received_at)
        VALUES($1,$2,'Received',$3,$3,'2026-09-02T12:00:00Z') RETURNING id`, [supplier, branch, user])).rows[0].id);
      await db.query(`INSERT INTO restock_request_items(restock_request_id,inventory_item_id,requested_quantity,delivered_quantity,unit_cost)
        VALUES($1,$2,$3,$3,10)`, [restock, item, quantity]);
    }
    const report = (actor: BranchActor, branch: string | null) => getRevenueReport(db, range, actor, branch);
    assert.equal((await report(admin, String(main))).summary.grossSales, 100);
    assert.equal((await report(admin, String(other))).summary.grossSales, 300);
    assert.equal((await report(admin, "all")).summary.grossSales, 400);
    assert.equal((await report(admin, "all")).summary.transactionCount, 2);
    assert.equal((await report(manager, null)).summary.grossSales, 100);
    // Current barber ownership must not reattribute historical bookings or sales.
    await db.query("UPDATE barbers SET branch_id=$2 WHERE id=$1", [barbers[0], other]);
    assert.equal((await report(admin, String(main))).summary.grossSales, 100);
    for (const [index, action, amount] of [[0, "void", 100], [1, "refund", 300]] as const) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`INSERT INTO transaction_financial_actions(transaction_id,action_type,amount,reason,staff_name,created_at)
          VALUES($1,$2,$3,'Branch report test','Manager','2026-09-03T12:00:00+08:00')`, [sales[index], action, amount]);
        const status = action === "void" ? "voided" : "refunded";
        await client.query("UPDATE transactions SET status=$2 WHERE id=$1", [sales[index], status]);
        await client.query("UPDATE transaction_payments SET status=$2 WHERE transaction_id=$1", [sales[index], status]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      const own = (await report(admin, String(index === 0 ? main : other))).summary;
      assert.equal(own.netRevenue, 0);
      assert.equal(index === 0 ? own.voidedAmount : own.refundedAmount, amount);
      assert.equal((await report(admin, String(other))).summary.netRevenue, index === 0 ? 300 : 0);
    }
    await applyMigrations(db);
    const global = (await report(admin, "all")).summary;
    assert.deepEqual([global.grossSales, global.reversedAmount, global.netRevenue, global.transactionCount], [400, 400, 0, 2]);
    const from = new Date("2026-09-02T00:00:00Z"), to = new Date("2026-09-03T00:00:00Z");
    const inventory = (actor: BranchActor, branch: string | null) => getInventoryReport(db, actor, from, to, branch);
    for (const [branch, value, usage] of [[String(main),20,2], [String(other),50,5], ["all",70,7]] as const) {
      const result = await inventory(admin, branch);
      assert.equal(result.valuation.totalValue, value);
      assert.equal(result.supplierSpending[0].totalSpend, value);
      assert.equal(result.supplierSpending[0].receivedDeliveries, branch === "all" ? 2 : 1);
      assert.equal(result.usageSummary.reduce((sum, row) => sum + row.used, 0), usage);
      assert.equal(result.movements.length, branch === "all" ? 2 : 1);
      const dashboard = await getDashboardReport(db, admin, branch);
      assert.equal(dashboard.inventoryValue, value);
      assert.equal(dashboard.recentDeliveries.length, branch === "all" ? 2 : 1);
      assert.equal(dashboard.todayBookings, branch === "all" ? 2 : 1);
      assert.equal(dashboard.customers, 1, "a shared customer is counted once globally");
    }
    assert.equal((await inventory(manager, null)).valuation.totalValue, 20);
    assert.equal((await getDashboardReport(db, manager)).inventoryValue, 20);
    const denied = (error: unknown) => error instanceof BranchError && error.status === 403;
    await assert.rejects(() => report(manager, String(other)), denied);
    await assert.rejects(() => inventory(manager, String(other)), denied);
    await assert.rejects(() => getDashboardReport(db, manager, "all"), denied);
    apiActor = manager;
    const routes = await Promise.all([import("@/app/api/reports/revenue/route"), import("@/app/api/reports/inventory/route"), import("@/app/api/reports/dashboard/route")]);
    for (const route of routes) for (const branch of [String(other), "all"])
      assert.equal((await route.GET(new Request(`http://localhost/api/reports?branchId=${branch}`))).status, 403);
    apiActor = { id: user, role: "front_desk" };
    for (const route of routes) assert.equal((await route.GET(new Request("http://localhost/api/reports"))).status, 403);
    await db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [user, other]);
    assert.equal((await report(manager, null)).summary.grossSales, 400);
    assert.equal((await inventory(manager, null)).valuation.totalValue, 70);
    assert.equal((await getDashboardReport(db, manager)).inventoryValue, 70);
    await db.query("DELETE FROM user_branches WHERE user_id=$1", [user]);
    assert.equal((await report(manager, null)).summary.grossSales, 0);
    assert.equal((await inventory(manager, null)).valuation.totalValue, 0);
    assert.equal((await getDashboardReport(db, manager)).customers, 0);
  } finally { apiActor = admin; await cleanup(); }
});

test("legacy movement and restock snapshots retain their branch even when the item differs", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(26);
  try {
    const main = Number((await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id);
    const second = Number((await db.query("INSERT INTO branches(name,code) VALUES('Second Branch','SECOND') RETURNING id")).rows[0].id);
    const user = Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) SELECT 'Legacy','Admin','legacy.report@test.local','hash',id FROM roles WHERE name='administrator' RETURNING id")).rows[0].id);
    const supplier = Number((await db.query("INSERT INTO suppliers(company_name) VALUES('Legacy supplier') RETURNING id")).rows[0].id);
    const item = Number((await db.query("INSERT INTO inventory_items(name,category,quantity,unit_cost,branch) VALUES('Legacy product','Products',5,10,'Main Branch') RETURNING id")).rows[0].id);
    await db.query(`INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity,previous_stock,new_stock,created_by,branch,created_at)
      VALUES($1,'USE',4,9,5,$2,'Second Branch','2026-09-02T12:00:00Z')`, [item, user]);
    const restock = Number((await db.query(`INSERT INTO restock_requests(supplier_id,requested_by,status,branch,received_at)
      VALUES($1,$2,'Received','Second Branch','2026-09-02T12:00:00Z') RETURNING id`, [supplier, user])).rows[0].id);
    await db.query("INSERT INTO restock_request_items(restock_request_id,inventory_item_id,requested_quantity,delivered_quantity,unit_cost) VALUES($1,$2,1,1,NULL)", [restock, item]);
    await applyMigrations(db);
    const report = (branch: string) => getInventoryReport(db, admin, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-03T00:00:00Z"), branch);
    const own = await report(String(main)), historical = await report(String(second)), global = await report("all");
    assert.equal(own.valuation.totalValue, 50);
    assert.equal(own.usageSummary[0].used, 0);
    assert.deepEqual(own.supplierSpending, []);
    assert.equal(historical.valuation.totalValue, 0);
    assert.equal(historical.usageSummary[0].used, 4);
    assert.equal(historical.usageSummary[0].currentQuantity, null);
    assert.equal(historical.movements.length, 1);
    assert.equal(historical.supplierSpending[0].totalSpend, null, "unknown historical cost stays unknown despite the item's current cost");
    assert.equal(global.usageSummary.reduce((sum, row) => sum + row.used, 0), 4);
    assert.equal(global.supplierSpending[0].totalSpend, null);
  } finally { await cleanup(); }
});
