import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createDisposableSchema } from "./helpers/database";

let activePool: Pool;
let sessionCookie: string | undefined;
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
  namedExports: {
    cookies: async () => ({
      get: (name: string) => name === "barracks_session" && sessionCookie
        ? { value: sessionCookie }
        : undefined,
    }),
  },
});

const freshPassword = () => randomBytes(24).toString("base64url");
const freshEmail = (kind: string) => `codex.${kind}.${randomUUID()}@barracks.local`;
const request = (body: unknown) => new Request("http://localhost/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function readCookie(response: Response): string | undefined {
  const value = response.headers.get("set-cookie")?.split(";")[0];
  return value?.startsWith("barracks_session=")
    ? decodeURIComponent(value.slice("barracks_session=".length))
    : undefined;
}

test("account routes persist signup, session, ownership, supplier linkage and password workflows", async () => {
  const disposable = await createDisposableSchema();
  activePool = disposable.db;
  sessionCookie = undefined;

  try {
    const [login, logout, signup, currentUser, customerProfile, supplierAccount, supplierPasswordRoute] = await Promise.all([
      import("@/app/api/auth/login/route"),
      import("@/app/api/auth/logout/route"),
      import("@/app/api/auth/signup/route"),
      import("@/app/api/auth/me/route"),
      import("@/app/api/customers/me/route"),
      import("@/app/api/suppliers/[id]/account/route"),
      import("@/app/api/supplier/account/route"),
    ]);
    const { createUser } = await import("@/server/services/user.service");
    const { createSupplier } = await import("@/server/services/supplier.service");
    const { verifyPassword } = await import("@/server/services/password.service");

    // Registration creates only a customer identity and linked profile.
    const customerEmail = freshEmail("customer");
    const customerPassword = freshPassword();
    const registration = await signup.POST(request({
      firstName: "Synthetic", lastName: "Customer", email: customerEmail,
      password: customerPassword, phone: "09123456789",
    }));
    assert.equal(registration.status, 201);
    sessionCookie = readCookie(registration);
    assert.ok(sessionCookie);
    const registered = await registration.json();
    assert.equal(registered.user.role, "customer");
    assert.equal("password" in registered.user, false);
    assert.equal("passwordHash" in registered.user, false);
    const registeredRows = await disposable.db.query(`
      SELECT u.id, r.name AS role, u.password_hash, c.id AS customer_id
      FROM users u JOIN roles r ON r.id=u.role_id JOIN customers c ON c.user_id=u.id
      WHERE u.email=$1`, [customerEmail]);
    assert.equal(registeredRows.rowCount, 1);
    assert.equal(registeredRows.rows[0].role, "customer");
    assert.notEqual(registeredRows.rows[0].password_hash, customerPassword);
    assert.equal(await verifyPassword(customerPassword, registeredRows.rows[0].password_hash), true);

    const duplicate = await signup.POST(request({
      firstName: "Duplicate", lastName: "Customer", email: customerEmail,
      password: freshPassword(), phone: "09123456789",
    }));
    assert.equal(duplicate.status, 409);
    const beforePrivilegedSignup = await disposable.db.query("SELECT count(*)::int AS count FROM users");
    const privileged = await signup.POST(request({
      firstName: "Synthetic", lastName: "Intruder", email: freshEmail("privileged"),
      password: freshPassword(), role: "administrator", isVerified: true,
    }));
    assert.equal(privileged.status, 400);
    const afterPrivilegedSignup = await disposable.db.query("SELECT count(*)::int AS count FROM users");
    assert.equal(afterPrivilegedSignup.rows[0].count, beforePrivilegedSignup.rows[0].count);

    // Session identity reloads from storage; self-profile writes cannot select an owner or alter loyalty.
    const reloaded = await currentUser.GET();
    assert.equal(reloaded.status, 200);
    assert.equal((await reloaded.json()).user.email, customerEmail);
    const profile = await customerProfile.GET();
    assert.equal(profile.status, 200);
    const customer = (await profile.json()).customer;
    const profileUpdate = await customerProfile.PUT(request({
      firstName: "Updated", lastName: "Customer", email: customerEmail,
      phone: "09123456788", preferredBarberId: null,
    }));
    assert.equal(profileUpdate.status, 200);
    const persistedProfile = await customerProfile.GET();
    assert.equal((await persistedProfile.json()).customer.firstName, "Updated");
    const loyaltyAttempt = await customerProfile.PUT(request({
      firstName: "Updated", lastName: "Customer", email: customerEmail,
      phone: "09123456788", preferredBarberId: null, loyaltyPoints: 999,
    }));
    assert.equal(loyaltyAttempt.status, 400);
    const ownerSpoof = await customerProfile.PUT(request({
      customerId: Number(customer.id), firstName: "Other", lastName: "Owner",
      email: customerEmail, phone: "09123456788", preferredBarberId: null,
    }));
    assert.equal(ownerSpoof.status, 400);
    const directCustomerRoute = await import("@/app/api/customers/[id]/route");
    const crossOwner = await directCustomerRoute.PUT(request({
      firstName: "Other", lastName: "Owner", email: customerEmail,
      phone: "09123456788", preferredBarberId: null,
    }), { params: Promise.resolve({ id: String(customer.id) }) });
    assert.equal(crossOwner.status, 403);
    const customerReport = await (await import("@/app/api/reports/revenue/route")).GET(
      new Request("http://localhost/api/reports/revenue"),
    );
    assert.equal(customerReport.status, 403);

    // Invalid, unverified, blocked and deleted accounts never receive a session.
    const sessionCount = async () => Number((await disposable.db.query("SELECT count(*)::int AS count FROM sessions")).rows[0].count);
    const sessionsBeforeInvalid = await sessionCount();
    const invalidLogin = await login.POST(request({ email: customerEmail, password: freshPassword() }));
    assert.equal(invalidLogin.status, 401);
    assert.equal(readCookie(invalidLogin), undefined);
    assert.equal(await sessionCount(), sessionsBeforeInvalid);

    const blockedEmail = freshEmail("blocked");
    const blockedPassword = freshPassword();
    const blocked = await createUser(disposable.db, {
      firstName: "Blocked", lastName: "Synthetic", email: blockedEmail,
      password: blockedPassword, role: "front_desk",
    });
    assert.equal(blocked.kind, "created");
    if (blocked.kind !== "created") throw new Error("Blocked fixture creation failed");
    await disposable.db.query("UPDATE users SET is_verified=TRUE,is_blocked=TRUE WHERE id=$1", [blocked.user.id]);
    const blockedLogin = await login.POST(request({ email: blockedEmail, password: blockedPassword }));
    assert.equal(blockedLogin.status, 403);
    assert.equal(readCookie(blockedLogin), undefined);

    const unverifiedEmail = freshEmail("unverified");
    const unverifiedPassword = freshPassword();
    const unverified = await createUser(disposable.db, {
      firstName: "Unverified", lastName: "Synthetic", email: unverifiedEmail,
      password: unverifiedPassword, role: "front_desk",
    });
    assert.equal(unverified.kind, "created");
    const unverifiedLogin = await login.POST(request({ email: unverifiedEmail, password: unverifiedPassword }));
    assert.equal(unverifiedLogin.status, 403);
    assert.equal(readCookie(unverifiedLogin), undefined);

    const deletedEmail = freshEmail("deleted");
    const deletedPassword = freshPassword();
    const deleted = await createUser(disposable.db, {
      firstName: "Deleted", lastName: "Synthetic", email: deletedEmail,
      password: deletedPassword, role: "front_desk",
    });
    assert.equal(deleted.kind, "created");
    if (deleted.kind !== "created") throw new Error("Deleted fixture creation failed");
    await disposable.db.query("UPDATE users SET is_verified=TRUE,deleted_at=NOW() WHERE id=$1", [deleted.user.id]);
    const deletedLogin = await login.POST(request({ email: deletedEmail, password: deletedPassword }));
    assert.equal(deletedLogin.status, 401);
    assert.equal(readCookie(deletedLogin), undefined);

    // Supplier account creation is atomic, uniquely linked and usable for password change.
    const adminEmail = freshEmail("admin");
    const adminPassword = freshPassword();
    const admin = await createUser(disposable.db, {
      firstName: "Synthetic", lastName: "Admin", email: adminEmail,
      password: adminPassword, role: "administrator",
    });
    assert.equal(admin.kind, "created");
    const adminLogin = await login.POST(request({ email: adminEmail, password: adminPassword }));
    assert.equal(adminLogin.status, 200);
    sessionCookie = readCookie(adminLogin);
    assert.ok(sessionCookie);

    const supplier = await createSupplier(disposable.db, {
      companyName: `Synthetic Supply ${randomUUID()}`, contactPerson: "Test Contact",
      phone: "09123456789", email: "", address: "Local test", notes: "", status: "active",
    });
    const supplierEmail = freshEmail("supplier");
    const supplierPassword = freshPassword();
    const accountResponse = await supplierAccount.POST(request({
      firstName: "Synthetic", lastName: "Supplier", email: supplierEmail, password: supplierPassword,
    }), { params: Promise.resolve({ id: String(supplier.id) }) });
    assert.equal(accountResponse.status, 201);
    const accountUserId = (await accountResponse.json()).userId;
    const linkedRows = await disposable.db.query(`
      SELECT u.id, r.name AS role, sa.supplier_id, u.password_hash
      FROM users u JOIN roles r ON r.id=u.role_id JOIN supplier_accounts sa ON sa.user_id=u.id
      WHERE u.id=$1`, [accountUserId]);
    assert.equal(linkedRows.rowCount, 1);
    assert.equal(linkedRows.rows[0].role, "supplier");
    assert.equal(Number(linkedRows.rows[0].supplier_id), supplier.id);
    assert.equal(await verifyPassword(supplierPassword, linkedRows.rows[0].password_hash), true);

    const duplicateEmail = await supplierAccount.POST(request({
      firstName: "Duplicate", lastName: "Supplier", email: adminEmail, password: freshPassword(),
    }), { params: Promise.resolve({ id: String(supplier.id) }) });
    assert.equal(duplicateEmail.status, 400);
    const duplicateLink = await supplierAccount.POST(request({
      firstName: "Duplicate", lastName: "Link", email: freshEmail("supplier2"), password: freshPassword(),
    }), { params: Promise.resolve({ id: String(supplier.id) }) });
    assert.equal(duplicateLink.status, 400);
    const accountCount = await disposable.db.query("SELECT count(*)::int AS count FROM supplier_accounts WHERE supplier_id=$1", [supplier.id]);
    assert.equal(accountCount.rows[0].count, 1);

    const supplierLogin = await login.POST(request({ email: supplierEmail, password: supplierPassword }));
    assert.equal(supplierLogin.status, 200);
    sessionCookie = readCookie(supplierLogin);
    assert.ok(sessionCookie);
    const originalHash = linkedRows.rows[0].password_hash as string;
    const wrongCurrent = await supplierPasswordRoute.PATCH(request({ currentPassword: freshPassword(), newPassword: freshPassword() }));
    assert.equal(wrongCurrent.status, 400);
    let currentHash = await disposable.db.query("SELECT password_hash FROM users WHERE id=$1", [accountUserId]);
    assert.equal(currentHash.rows[0].password_hash, originalHash);
    const samePassword = await supplierPasswordRoute.PATCH(request({ currentPassword: supplierPassword, newPassword: supplierPassword }));
    assert.equal(samePassword.status, 400);
    currentHash = await disposable.db.query("SELECT password_hash FROM users WHERE id=$1", [accountUserId]);
    assert.equal(currentHash.rows[0].password_hash, originalHash);
    // A password change signs out other devices and keeps the current session.
    assert.equal((await login.POST(request({ email: supplierEmail, password: supplierPassword }))).status, 200);
    const supplierSessions = async () => Number((await disposable.db.query("SELECT count(*)::int AS count FROM sessions WHERE user_id=$1", [accountUserId])).rows[0].count);
    assert.equal(await supplierSessions(), 2);
    const changedPassword = freshPassword();
    const changed = await supplierPasswordRoute.PATCH(request({ currentPassword: supplierPassword, newPassword: changedPassword }));
    assert.equal(changed.status, 200);
    assert.equal(await supplierSessions(), 1);
    assert.equal((await currentUser.GET()).status, 200);
    currentHash = await disposable.db.query("SELECT password_hash FROM users WHERE id=$1", [accountUserId]);
    assert.notEqual(currentHash.rows[0].password_hash, changedPassword);
    assert.equal(await verifyPassword(changedPassword, currentHash.rows[0].password_hash), true);
    assert.equal((await login.POST(request({ email: supplierEmail, password: supplierPassword }))).status, 401);
    const newPasswordLogin = await login.POST(request({ email: supplierEmail, password: changedPassword }));
    assert.equal(newPasswordLogin.status, 200);
    sessionCookie = readCookie(newPasswordLogin);
    assert.ok(sessionCookie);

    // Logout invalidates the persisted session; replaying its old cookie is rejected.
    const previousCookie = sessionCookie;
    const signedOut = await logout.POST();
    assert.equal(signedOut.status, 200);
    assert.match(signedOut.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    sessionCookie = previousCookie;
    const replayed = await currentUser.GET();
    assert.equal(replayed.status, 401);
    const signedOutReports = await (await import("@/app/api/reports/revenue/route")).GET(
      new Request("http://localhost/api/reports/revenue"),
    );
    assert.equal(signedOutReports.status, 401);
  } finally {
    sessionCookie = undefined;
    await disposable.cleanup();
  }
});
