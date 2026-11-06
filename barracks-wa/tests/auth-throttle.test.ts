import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { createDisposableSchema } from "./helpers/database";

let activePool: Pool;
const testPool = {
  query(...args: Parameters<Pool["query"]>) {
    return activePool.query(...args) as unknown as Promise<QueryResult>;
  },
  connect() {
    return activePool.connect() as Promise<PoolClient>;
  },
};
mock.module("@/server/db/pool", { namedExports: { pool: testPool } });
mock.module("next/headers", {
  namedExports: { cookies: async () => ({ get: () => undefined }) },
});

const request = (body: unknown, ip?: string) => new Request("http://localhost/api", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {}) },
  body: JSON.stringify(body),
});
const statuses = async (count: number, attempt: (index: number) => Promise<Response>) => {
  const result: number[] = [];
  for (let index = 0; index < count; index++) result.push((await attempt(index)).status);
  return result;
};
const customer = (email: string) => ({
  firstName: "Throttle", lastName: "Check", email, password: "correct-horse-battery", phone: "09123456789",
});

test("login and signup limits apply per account and address, and success resets the account", async () => {
  const disposable = await createDisposableSchema();
  activePool = disposable.db;
  try {
    const [{ POST: login }, { POST: signup }] = await Promise.all([
      import("@/app/api/auth/login/route"),
      import("@/app/api/auth/signup/route"),
    ]);
    const attempt = (email: string, password: string, ip?: string) => login(request({ email, password }, ip));
    const email = "throttled@test.local";
    assert.equal((await signup(request(customer(email)))).status, 201);

    // Ten failures from one address, then blocked even with the right password.
    assert.deepEqual(await statuses(10, () => attempt(email, "wrong-password", "203.0.113.1")), Array(10).fill(401));
    const blocked = await attempt(email, "correct-horse-battery", "203.0.113.1");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.match((await blocked.json()).message, /Too many attempts/);

    // Another address still works, and that success clears the account's counters.
    assert.equal((await attempt(email, "correct-horse-battery", "203.0.113.2")).status, 200);
    assert.deepEqual(await statuses(10, () => attempt(email, "wrong-password", "203.0.113.2")), Array(10).fill(401));

    // Counters hold only hashes, never an email or address.
    const stored = await disposable.db.query<{ key_hash: string }>("SELECT key_hash FROM auth_attempts");
    assert.ok(stored.rows.length > 0);
    assert.ok(stored.rows.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash)));

    // Guesses spread across addresses stop at the account limit.
    await disposable.db.query("DELETE FROM auth_attempts");
    const spread = await statuses(31, (index) => attempt(email, "wrong-password", `192.0.2.${index + 1}`));
    assert.deepEqual(spread.slice(0, 30), Array(30).fill(401));
    assert.equal(spread[30], 429);

    // One address stops across many accounts, and an expired window opens again.
    await disposable.db.query("DELETE FROM auth_attempts");
    const sweep = await statuses(101, (index) => attempt(`nobody${index}@test.local`, "wrong-password", "192.0.2.200"));
    assert.deepEqual(sweep.slice(0, 100), Array(100).fill(401));
    assert.equal(sweep[100], 429);
    await disposable.db.query("UPDATE auth_attempts SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal((await attempt("nobody0@test.local", "wrong-password", "192.0.2.200")).status, 401);

    const signups = await statuses(11, (index) => signup(request(customer(`signup${index}@test.local`), "203.0.113.9")));
    assert.deepEqual(signups.slice(0, 10), Array(10).fill(201));
    assert.equal(signups[10], 429);

    // Sign-in stays available if the counters cannot be used.
    // Fail the queries directly: a renamed table would still resolve to a copy
    // in public when the database has been migrated.
    const logged = mock.method(console, "error", () => undefined);
    activePool = {
      query: (text: unknown, ...rest: unknown[]) =>
        String(text).includes("auth_attempts")
          ? Promise.reject(new Error("counters unavailable"))
          : (disposable.db.query as (...args: unknown[]) => Promise<QueryResult>)(text, ...rest),
      connect: () => disposable.db.connect(),
    } as unknown as Pool;
    try {
      assert.equal((await attempt(email, "correct-horse-battery", "203.0.113.20")).status, 200);
      assert.ok(logged.mock.calls.some((call) => call.arguments[0] === "Unable to check auth attempt limits"));
    } finally {
      activePool = disposable.db;
      logged.mock.restore();
    }
  } finally {
    await disposable.cleanup();
  }
});

test("account and payment writes finish on a pool of one connection", async () => {
  const disposable = await createDisposableSchema();
  const small = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
    options: `-c search_path=${disposable.schema},public,pg_catalog`,
    max: 1,
    // A nested connection request fails here instead of hanging the test.
    connectionTimeoutMillis: 3_000,
  });
  try {
    const { createCustomer, updateCustomer } = await import("@/server/services/customer.service");
    const { createTransaction, applyFinancialAction } = await import("@/server/services/payment.service");
    const created = await createCustomer(small, { ...customer("small-pool@test.local"), preferredBarberId: null });
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    const updated = await updateCustomer(small, created.customer.id, {
      firstName: "Renamed", lastName: "Check", email: "small-pool@test.local", phone: "09123456789", preferredBarberId: null,
    });
    assert.equal(updated?.firstName, "Renamed");

    const admin = Number((await small.query<{ id: number }>(
      `INSERT INTO users(first_name,last_name,email,password_hash,role_id)
       VALUES('Small','Admin','small-admin@test.local','hash',(SELECT id FROM roles WHERE name='administrator')) RETURNING id`)).rows[0].id);
    const barber = Number((await small.query<{ id: number }>("INSERT INTO barbers(first_name,last_name) VALUES('Small','Barber') RETURNING id")).rows[0].id);
    const booking = Number((await small.query<{ id: number }>(
      `INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
       VALUES($1,$2,'barracks-basic','Original service',300,'2026-09-20','10:00','completed') RETURNING id`,
      [created.customer.id, barber])).rows[0].id);
    const sale = await createTransaction(small, { visit: { bookingId: booking }, paymentMethod: "cash", amountReceived: 500 }, admin);
    const refunded = await applyFinancialAction(small, sale.reference, { action: "refund", amount: 300, reason: "Desk error" }, admin);
    assert.equal(refunded.status, "refunded");
    assert.equal(refunded.actions?.length, 1);
  } finally {
    await small.end();
    await disposable.cleanup();
  }
});
