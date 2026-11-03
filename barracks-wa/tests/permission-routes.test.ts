import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { UserRole } from "@/app/constants/roles";

// Node module mocks isolate route authorization from PostgreSQL and cookies.
let actorRole: UserRole | null = null;
const queries: Array<{ sql: string; values: unknown[] }> = [];
const pool = {
  async connect() { return { query: pool.query, release() {} }; },
  async query(sql: string, values: unknown[] = []) {
    queries.push({ sql, values });
    if (sql.includes("FROM branches")) return { rows: [{ id: 1, name: "Main Branch", code: "MAIN", status: "active", address: "", phone: "", created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
    if (sql.includes("FROM user_branches")) return { rows: [{ branch_id: 1 }], rowCount: 1 };
    if (sql.includes("UPDATE barbers SET status")) return { rows: [{ id: 7, branch_id: 1, first_name: "Ana", last_name: "Barber", status: values[0] }], rowCount: 1 };
    if (sql.includes("FROM barbers") && sql.includes("WHERE id")) return { rows: [{ id: 7, branch_id: 1, first_name: "Ana", last_name: "Barber", status: "available", commission_rate: 20, services_done: 4, revenue: 1000, rating: 5, schedule_day_count: 7, created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
    if (sql.includes("FROM suppliers s") && sql.includes("WHERE id")) return { rows: [{ id: 7, company_name: "Supplies Co", contact_person: "Sam", phone: "09123456789", email: "", address: "", notes: "", status: "active", has_account: false, created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
    if (sql.includes("FROM transactions t JOIN transaction_payments p") && sql.includes("WHERE t.reference")) return { rows: [{ id: "9", reference: "TX-AUDIT", visit_type: "booking", visit_record_id: "1", booking_id: 1, queue_entry_id: null, customer_id: 2, barber_id: 3, service_id: "cut", processed_by: 4, customer_name: "Ava", barber_name: "Bea", cashier_name: "Fran", service_name: "Cut", amount: "300", amount_received: "300", change_amount: "0", payment_method: "cash", status: "refunded", created_at: new Date(), actions: [{ id: "2", transaction_id: "9", action_type: "refund", amount: "300", reason: "Manager correction", staff_id: 5, staff_name: "Mae", created_at: new Date() }] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
};
mock.module("@/server/db/pool", { namedExports: { pool } });
mock.module("@/server/auth/session", { namedExports: { getCurrentUser: async () => actorRole === null ? null : { id: 1, role: actorRole } } });

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Route = { path: string; method: Method; allowed: UserRole[]; body?: unknown; query?: string };
const routes: Route[] = [
  { path: "barbers", method: "GET", allowed: ["front_desk", "manager", "administrator", "customer"] },
  { path: "barbers", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "barbers", method: "PATCH", allowed: ["administrator"], body: {} },
  { path: "barbers/[id]", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "barbers/[id]", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "barbers/[id]", method: "DELETE", allowed: ["administrator"] },
  { path: "barbers/[id]/status", method: "PATCH", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "barbers/[id]/schedule", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "barbers/[id]/schedule", method: "DELETE", allowed: ["manager", "administrator"] },
  { path: "attendance/today", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "attendance/today/[barberId]", method: "POST", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "attendance/history", method: "GET", allowed: ["manager", "administrator"] },
  { path: "attendance/[id]/corrections", method: "GET", allowed: ["manager", "administrator"] },
  { path: "attendance/[id]/corrections", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "shop-hours", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "queue", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "queue", method: "POST", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "queue/[id]", method: "PATCH", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "queue/[id]", method: "DELETE", allowed: ["front_desk", "manager", "administrator"] },
  { path: "queue/next", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "queue/next", method: "POST", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "bookings", method: "GET", allowed: ["front_desk", "manager", "administrator", "customer"] },
  { path: "bookings", method: "POST", allowed: ["front_desk", "manager", "administrator", "customer"], body: {} },
  { path: "bookings/[id]", method: "PATCH", allowed: ["front_desk", "manager", "administrator", "customer"], body: {} },
  { path: "bookings/[id]", method: "PUT", allowed: ["front_desk", "manager", "administrator", "customer"], body: {} },
  { path: "bookings/[id]", method: "DELETE", allowed: ["front_desk", "manager", "administrator"] },
  { path: "customers", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "customers", method: "POST", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "customers/[id]", method: "PUT", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "customers/[id]", method: "DELETE", allowed: ["administrator"] },
  { path: "transactions", method: "GET", allowed: ["front_desk", "manager", "administrator"] },
  { path: "transactions", method: "POST", allowed: ["front_desk", "manager", "administrator"], body: {} },
  { path: "transactions/actions", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "users", method: "GET", allowed: ["manager", "administrator"] },
  { path: "users", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "users/[id]", method: "GET", allowed: ["manager", "administrator"] },
  { path: "users/[id]", method: "DELETE", allowed: ["manager", "administrator"] },
  { path: "users/[id]", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "users/[id]", method: "PATCH", allowed: ["manager", "administrator"], body: {} },
  { path: "services", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "services/[id]", method: "PATCH", allowed: ["manager", "administrator"], body: {} },
  { path: "inventory", method: "GET", allowed: ["manager", "administrator"] },
  { path: "inventory", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "inventory/[id]", method: "GET", allowed: ["manager", "administrator"] },
  { path: "inventory/[id]", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "inventory/[id]", method: "DELETE", allowed: ["manager", "administrator"] },
  { path: "inventory/[id]/movements", method: "GET", allowed: ["manager", "administrator"] },
  { path: "inventory/[id]/movements", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "inventory/[id]/threshold-history", method: "GET", allowed: ["manager", "administrator"] },
  { path: "inventory/alerts", method: "GET", allowed: ["manager", "administrator"] },
  { path: "inventory/alerts/[id]/acknowledge", method: "POST", allowed: ["manager", "administrator"] },
  { path: "suppliers", method: "GET", allowed: ["manager", "administrator"] },
  { path: "suppliers", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "suppliers/[id]", method: "GET", allowed: ["manager", "administrator"] },
  { path: "suppliers/[id]", method: "PUT", allowed: ["manager", "administrator"], body: {} },
  { path: "suppliers/[id]", method: "DELETE", allowed: ["administrator"] },
  { path: "suppliers/[id]/account", method: "POST", allowed: ["administrator"], body: {} },
  { path: "restocks", method: "GET", allowed: ["manager", "administrator", "supplier"] },
  { path: "restocks", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "restocks/[id]/delivered", method: "POST", allowed: ["manager", "administrator"] },
  { path: "restocks/[id]/receive", method: "POST", allowed: ["manager", "administrator"], body: {} },
  { path: "restocks/[id]/status", method: "PATCH", allowed: ["supplier"], body: {} },
  { path: "reports/inventory", method: "GET", allowed: ["manager", "administrator"] },
  { path: "reports/dashboard", method: "GET", allowed: ["manager", "administrator"] },
  { path: "reports/revenue", method: "GET", allowed: ["manager", "administrator"] },
];

const handlers = new Map<string, Record<string, (...args: never[]) => Promise<Response>>>();
for (const route of routes) {
  if (!handlers.has(route.path)) handlers.set(route.path, await import(`../app/api/${route.path}/route.ts`));
}

async function call(route: Route, role: UserRole | null): Promise<Response> {
  actorRole = role;
  queries.length = 0;
  const path = route.path.replace("[id]", "7").replace("[barberId]", "7");
  const request = new Request(`http://localhost/api/${path}${route.query ?? ""}`, {
    method: route.method,
    ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
  });
  const handler = handlers.get(route.path)?.[route.method];
  assert.ok(handler, `${route.method} ${route.path}`);
  return handler(request as never, { params: Promise.resolve({ id: "7", barberId: "7" }) } as never);
}

test("attendance role gates allow Front Desk today and management history/corrections", async () => {
  for (const role of ["front_desk", "manager", "administrator"] as const) {
    assert.equal((await call({ path: "attendance/today", method: "GET", allowed: [] }, role)).status, 200);
    assert.equal((await call({ path: "attendance/today/[barberId]", method: "POST", allowed: [], body: {} }, role)).status, 400);
  }
  for (const role of ["manager", "administrator"] as const) {
    assert.equal((await call({ path: "attendance/history", method: "GET", allowed: [] }, role)).status, 200);
    assert.equal((await call({ path: "attendance/[id]/corrections", method: "GET", allowed: [] }, role)).status, 200);
    assert.equal((await call({ path: "attendance/[id]/corrections", method: "POST", allowed: [], body: {} }, role)).status, 400);
  }
  assert.equal((await call({ path: "attendance/history", method: "GET", allowed: [] }, "front_desk")).status, 403);
  assert.equal((await call({ path: "attendance/[id]/corrections", method: "POST", allowed: [], body: {} }, "front_desk")).status, 403);
});

test("direct API calls return 401 without a session and 403 for disallowed roles before any database access", async () => {
  for (const route of routes) {
    assert.equal((await call(route, null)).status, 401, `${route.method} ${route.path}: anonymous`);
    assert.equal(queries.length, 0);
    for (const role of ["front_desk", "manager", "administrator", "customer", "supplier"] as const) {
      if (route.allowed.includes(role)) continue;
      assert.equal((await call(route, role)).status, 403, `${route.method} ${route.path}: ${role}`);
      assert.equal(queries.length, 0);
    }
  }
});

test("allowed daily and management writes pass authorization, while barber status changes only its status", async () => {
  for (const [path, method, role] of [
    ["queue", "POST", "front_desk"], ["bookings", "POST", "front_desk"],
    ["transactions", "POST", "front_desk"], ["barbers", "POST", "manager"],
    ["services", "POST", "manager"], ["inventory", "POST", "manager"],
    ["suppliers", "POST", "manager"], ["restocks", "POST", "manager"],
    ["transactions/actions", "POST", "administrator"],
  ] as const) {
    const route = routes.find((item) => item.path === path && item.method === method)!;
    const result = await call(route, role);
    assert.equal(result.status, 400, `${method} ${path}: ${role} should reach input validation`);
  }
  for (const role of ["front_desk", "manager", "administrator"] as const) {
    const result = await call({ path: "barbers/[id]/status", method: "PATCH", allowed: [], body: { status: "busy" } }, role);
    assert.equal(result.status, 200, role);
    const writes = queries.filter(({ sql }) => sql.startsWith("UPDATE"));
    assert.deepEqual(writes.map(({ values }) => values), [["busy", 7]]);
    assert.match(writes[0].sql, /^UPDATE barbers SET status = \$1, updated_at = NOW\(\) WHERE id = \$2/);
    assert.deepEqual((await result.json()).barber, { id: 7, branchId: 1, firstName: "Ana", lastName: "Barber", status: "busy" });
  }
  const invalid = await call({ path: "barbers/[id]/status", method: "PATCH", allowed: [], body: { status: "busy", commissionRate: 90 } }, "front_desk");
  assert.equal(invalid.status, 400);
  assert.equal(queries.length, 0);
});

test("Front Desk barber reads expose only operational fields", async () => {
  const single = await call({ path: "barbers/[id]", method: "GET", allowed: [] }, "front_desk");
  assert.deepEqual((await single.json()).barber, { id: 7, firstName: "Ana", lastName: "Barber", status: "available" });
  const list = await call({ path: "barbers", method: "GET", allowed: [] }, "front_desk");
  assert.deepEqual((await list.json()).barbers, []);
  const barberQuery = queries.find(({ sql }) => sql.includes("FROM barbers"))!;
  assert.match(barberQuery.sql, /SELECT id, branch_id, first_name, last_name, status/);
  assert.equal(barberQuery.sql.includes("commission_rate"), false);
});

test("Manager cannot deactivate a supplier through profile update or DELETE", async () => {
  const body = { companyName: "Supplies Co", contactPerson: "Sam", phone: "09123456789", email: "", address: "", notes: "", status: "inactive" };
  const manager = await call({ path: "suppliers/[id]", method: "PUT", allowed: [], body }, "manager");
  assert.equal(manager.status, 403);
  assert.match((await manager.json()).message, /Administrator access/);
  assert.ok(queries.some(({ sql, values }) => sql.includes("NOT (status='active'") && values.at(-1) === false));
  assert.equal((await call({ path: "suppliers/[id]", method: "DELETE", allowed: [] }, "manager")).status, 403);
  const administrator = await call({ path: "suppliers/[id]", method: "PUT", allowed: [], body }, "administrator");
  assert.notEqual(administrator.status, 403);
  assert.ok(queries.some(({ sql, values }) => sql.includes("NOT (status='active'") && values.at(-1) === true));
});

test("Front Desk receipt omits management correction details while Management retains them", async () => {
  const route: Route = { path: "transactions", method: "GET", allowed: [], query: "?reference=TX-AUDIT" };
  const frontDesk = await call(route, "front_desk");
  assert.equal(frontDesk.status, 200);
  const dailyReceipt = (await frontDesk.json()).transaction;
  assert.equal(dailyReceipt.reference, "TX-AUDIT");
  assert.equal(dailyReceipt.paymentStatus, "refunded");
  assert.equal("actions" in dailyReceipt, false);
  for (const role of ["manager", "administrator"] as const) {
    const result = await call(route, role);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).transaction.actions[0].reason, "Manager correction");
  }
});
