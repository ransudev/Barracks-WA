import assert from "node:assert/strict";
import test from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { applyMigrations } from "@/server/db/migrate";
import { checkBranchAccess, getPrimaryBranch, listAccessibleBranches, requireBranchAccess } from "@/server/auth/branch-access";
import { BranchError, createBranch, findBranch, listAssignments, listBranchStaff, mutateAssignment, updateBranch } from "@/server/services/branch.service";
import { branchSchema, branchUpdateSchema } from "@/server/schemas/branch.schema";
import { resolveBranchSelection } from "@/app/utils/branch-context";
import type { UserRole } from "@/server/schemas/user.schema";

const roles: UserRole[] = ["administrator", "manager", "front_desk", "customer", "supplier"];
test("branch migration backfills only staff; CRUD, access, membership and primary constraints persist", { skip: !databaseConfigured }, async () => {
  const { db, cleanup } = await createDisposableSchema(21);
  try {
    const ids = {} as Record<UserRole, number>;
    for (const role of roles) ids[role] = (await db.query(`INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES($1::text,'Branch',$2,'test',(SELECT id FROM roles WHERE name=$1::text)) RETURNING id`, [role, `${role}@branch.test`])).rows[0].id;
    await applyMigrations(db);
    await applyMigrations(db); // The migration ledger prevents reseeding/resetting.
    const main = (await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id as number;
    assert.equal((await findBranch(db, main))?.name, "Main Branch");
    await assert.rejects(updateBranch(db, main, branchUpdateSchema.parse({ code: "PRIMARY" })), (error: unknown) => error instanceof BranchError && error.status === 409);
    assert.equal((await updateBranch(db, main, branchUpdateSchema.parse({ address: "New Road" })))?.code, "MAIN");
    assert.deepEqual((await listAssignments(db, main)).map((assignment) => assignment.userId).sort(), [ids.manager, ids.front_desk].sort());
    assert.deepEqual((await listBranchStaff(db)).map((person) => person.role).sort(), ["front_desk", "manager"]);
    for (const role of roles) assert.equal((await getPrimaryBranch(db, { id: ids[role], role }))?.id ?? null, ["manager", "front_desk"].includes(role) ? main : null);

    const second = await createBranch(db, branchSchema.parse({ name: "Second", code: "second", address: "Road", phone: "(02) 8123 4567" }));
    assert.equal(second.code, "SECOND");
    await assert.rejects(createBranch(db, branchSchema.parse({ name: "Duplicate", code: "SECOND" })), (error: unknown) => (error as { code: string }).code === "23505");
    const changed = await updateBranch(db, second.id, branchUpdateSchema.parse({ status: "inactive" }));
    assert.equal(changed?.address, "Road"); assert.equal(changed?.phone, "0281234567"); assert.equal(changed?.status, "inactive");
    assert.equal((await updateBranch(db, second.id, branchUpdateSchema.parse({ name: "Renamed", phone: "+63 917 123 4567" })))?.name, "Renamed");
    assert.equal(await updateBranch(db, 2147483647, { name: "Missing" }), null);
    assert.equal((await findBranch(db, second.id))?.status, "inactive");

    for (const role of roles) {
      const actor = { id: ids[role], role };
      assert.equal(await checkBranchAccess(db, actor, main), ["administrator", "manager", "front_desk"].includes(role));
      assert.equal(await checkBranchAccess(db, actor, second.id), role === "administrator");
      assert.equal(await checkBranchAccess(db, actor, 2147483647), false);
      assert.equal((await listAccessibleBranches(db, actor)).length, role === "administrator" ? 2 : ["manager", "front_desk"].includes(role) ? 1 : 0);
      if (role !== "administrator") await assert.rejects(requireBranchAccess(db, actor, second.id), (error: unknown) => error instanceof BranchError && error.status === 403);
      if (["customer", "supplier", "administrator"].includes(role)) {
        await assert.rejects(mutateAssignment(db, second.id, ids[role], "assign"), /Only Managers and Front Desk/);
        await assert.rejects(db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [ids[role], second.id]), (error: unknown) => (error as { code: string }).code === "23514");
      }
    }
    await requireBranchAccess(db, { id: ids.administrator, role: "administrator" }, second.id);
    await mutateAssignment(db, second.id, ids.manager, "assign");
    await mutateAssignment(db, second.id, ids.front_desk, "assign", true);
    for (const role of ["manager", "front_desk"] as const) {
      const actor = { id: ids[role], role };
      assert.equal(await checkBranchAccess(db, actor, second.id), true);
      assert.equal((await listAccessibleBranches(db, actor)).length, 2);
      await assert.rejects(mutateAssignment(db, second.id, ids[role], "assign"), (error: unknown) => error instanceof BranchError && error.status === 409);
      await assert.rejects(db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)", [ids[role], second.id]), (error: unknown) => (error as { code: string }).code === "23505");
    }
    await assert.rejects(db.query("UPDATE user_branches SET is_primary=TRUE WHERE user_id=$1 AND branch_id=$2", [ids.manager, second.id]), (error: unknown) => (error as { code: string }).code === "23505");
    await Promise.all([
      mutateAssignment(db, second.id, ids.manager, "primary"),
      mutateAssignment(db, main, ids.manager, "primary"),
    ]);
    assert.equal(Number((await db.query("SELECT count(*) FROM user_branches WHERE user_id=$1 AND is_primary", [ids.manager])).rows[0].count), 1);
    await mutateAssignment(db, second.id, ids.manager, "primary");
    assert.equal((await getPrimaryBranch(db, { id: ids.manager, role: "manager" }))?.id, second.id);
    await mutateAssignment(db, second.id, ids.manager, "remove");
    assert.equal(await getPrimaryBranch(db, { id: ids.manager, role: "manager" }), null);
    assert.equal(await checkBranchAccess(db, { id: ids.manager, role: "manager" }, second.id), false);
    await assert.rejects(mutateAssignment(db, second.id, ids.manager, "primary"), /Assignment not found/);
    await assert.rejects(mutateAssignment(db, 2147483647, ids.manager, "assign"), /Branch not found/);
    await Promise.allSettled([mutateAssignment(db, second.id, ids.manager, "assign"), mutateAssignment(db, second.id, ids.manager, "assign")]).then((results) => {
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    });
    await db.query("UPDATE users SET role_id=(SELECT id FROM roles WHERE name='administrator') WHERE id=$1", [ids.manager]);
    assert.equal((await db.query("SELECT 1 FROM user_branches WHERE user_id=$1", [ids.manager])).rowCount, 0);
    await db.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [ids.front_desk]);
    assert.equal((await db.query("SELECT 1 FROM user_branches WHERE user_id=$1", [ids.front_desk])).rowCount, 0);
  } finally { await cleanup(); }
});

test("branch update defaults never overwrite omitted fields; selection reconciles server context", () => {
  assert.deepEqual(branchUpdateSchema.parse({ status: "inactive" }), { status: "inactive" });
  assert.equal(branchUpdateSchema.safeParse({}).success, false);
  assert.equal(branchSchema.safeParse({ name: "Shop", code: "bad code" }).success, false);
  const first = { id: 1, name: "One", code: "ONE", address: "", phone: "", status: "active" as const, createdAt: "", updatedAt: "" };
  const second = { ...first, id: 2, name: "Two" };
  const context = { branches: [first, second], primaryBranch: second };
  assert.equal(resolveBranchSelection(context)?.id, 2);
  assert.equal(resolveBranchSelection(context, 1)?.id, 1);
  assert.equal(resolveBranchSelection(context, 99)?.id, 2);
  assert.equal(resolveBranchSelection({ branches: [], primaryBranch: second }), null);
});
