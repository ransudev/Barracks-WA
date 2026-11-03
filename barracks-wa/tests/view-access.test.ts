import assert from "node:assert/strict";
import test from "node:test";
import { frontDeskNavigation, managementNavigation, viewAccessGroups } from "@/app/constants/navigation";
import type { ViewId } from "@/app/types/domain";
import { viewPaths } from "@/app/utils/routes";
import { canAccessView, canonicalView, requiresManagement, workspaceAreaForView } from "@/app/utils/view";

test("every route has a view-access group and Management navigation matches its access group", () => {
  assert.deepEqual(Object.keys(viewAccessGroups).sort(), Object.keys(viewPaths).sort());
  assert.deepEqual(frontDeskNavigation.map((item) => item.id), ["staff-dashboard", "queue", "bookings", "payments", "customers", "barbers"]);
  assert.equal(frontDeskNavigation.find((item) => item.id === "barbers")?.label, "Barber Floor");
  assert.deepEqual(managementNavigation.map((item) => item.id), ["admin-dashboard", "staff-dashboard", "bookings", "queue", "payments", "admin-customers", "staff-management", "admin-barbers", "barbers", "admin-attendance", "admin-payroll", "admin-services", "admin-reports", "admin-branches", "admin-inventory", "admin-suppliers", "admin-restocks"]);
  assert.equal(managementNavigation.find((item) => item.id === "payments")?.label, "Payments");
  assert.equal(managementNavigation.find((item) => item.id === "staff-dashboard")?.label, "Front Desk Today");
});

test("direct view access matches role navigation", () => {
  const cases: Array<[ViewId, string | null, boolean]> = [
    ["admin-branches", "administrator", true],
    ["admin-branches", "manager", false],
    ["admin-branches", "front_desk", false],
    ["admin-branches", "customer", false],
    ["admin-branches", "supplier", false],
    ["landing", null, true],
    ["customer-dashboard", "customer", true],
    ["customer-dashboard", "front_desk", false],
    ["supplier-dashboard", "supplier", true],
    ["supplier-dashboard", "manager", false],
    ["staff-dashboard", "front_desk", true],
    ["staff-dashboard", "administrator", true],
    ["staff-dashboard", "manager", true],
    ["queue", "front_desk", true],
    ["queue", "manager", true],
    ["queue", "administrator", true],
    ["queue", "customer", false],
    ["barbers", "front_desk", true],
    ["barbers", "manager", true],
    ["admin-barbers", "front_desk", false],
    ["admin-barbers", "manager", true],
    ["admin-attendance", "front_desk", false],
    ["admin-attendance", "manager", true],
    ["admin-attendance", "administrator", true],
    ["payments", "front_desk", true],
    ["payments", "manager", true],
    ["staff-management", "front_desk", false],
    ["staff-management", "manager", true],
    ["staff-management", "administrator", true],
    ["admin-services", "manager", true],
    ["admin-services", "administrator", true],
    ["admin-services", null, false],
  ];
  for (const [view, role, allowed] of cases) {
    assert.equal(canAccessView(view, role), allowed, `${role} -> ${view}`);
  }
  for (const item of frontDeskNavigation) assert.equal(canAccessView(item.id, "front_desk"), true, item.id);
  for (const item of managementNavigation) assert.equal(canAccessView(item.id, "manager"), item.id !== "admin-branches", item.id);
  for (const item of managementNavigation) assert.equal(canAccessView(item.id, "administrator"), true, item.id);
  for (const view of ["inventory", "staff-suppliers", "restocks", "admin-inventory", "admin-suppliers", "admin-restocks", "admin-reports", "admin-services", "admin-attendance", "staff-management"] as ViewId[]) {
    assert.equal(canAccessView(view, "front_desk"), false, view);
  }
  // Management roles also run the daily operational pages within their branch authority.
  for (const view of ["staff-dashboard", "queue", "bookings", "customers", "barbers"] as ViewId[]) {
    assert.equal(canAccessView(view, "manager"), true, view);
  }
  assert.equal(canonicalView("inventory"), "admin-inventory");
  assert.equal(canonicalView("staff-suppliers"), "admin-suppliers");
  assert.equal(canonicalView("restocks"), "admin-restocks");
  assert.equal(canonicalView("barbers"), "barbers");
  assert.equal(workspaceAreaForView("payments", "front_desk"), "staff");
  assert.equal(workspaceAreaForView("payments", "manager"), "admin");
  assert.equal(workspaceAreaForView("payments", "administrator"), "admin");
  assert.equal(workspaceAreaForView("admin-barbers", "manager"), "admin");
  assert.equal(workspaceAreaForView("barbers", "administrator"), "admin");
  assert.equal(workspaceAreaForView("barbers", "front_desk"), "staff");
  assert.equal(requiresManagement("staff-management"), true);
});
