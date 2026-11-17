import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { ApiRole } from "@/app/lib/api";
import type { Branch, BranchAssignment, BranchStaff } from "@/app/types/branch";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BranchesManagement } = await import("@/app/pages/admin/BranchesManagement");
const branch: Branch = { id: 1, name: "Main Branch", code: "MAIN", address: "Road", phone: "123", status: "active", createdAt: "", updatedAt: "" };
const staff: BranchStaff = { id: 2, firstName: "Mae", lastName: "Manager", role: "manager" };
const button = (label: string) => {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  assert.ok(found, `Missing ${label}`); return found;
};
const click = async (label: string) => { await act(async () => button(label).click()); };
async function render(role: ApiRole) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<BranchesManagement currentUserRole={role} onToast={() => undefined} />));
  return async () => { await act(async () => root.unmount()); container.remove(); };
}

test("non-Administrator branch page renders denial without fetching data", async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected fetch"); };
  try {
    for (const role of ["manager", "front_desk", "customer", "supplier"] as const) {
      const cleanup = await render(role);
      assert.match(document.body.textContent ?? "", /You do not have access/);
      await cleanup();
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = previous; }
});

test("Administrator status and assignment controls reload persisted API state", async () => {
  const previous = globalThis.fetch;
  let current = { ...branch };
  let memberships: BranchAssignment[] = [];
  const mutations: Array<{ path: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") mutations.push({ path, method, body });
    if (path === "/api/branches") return Response.json({ success: true, branches: [current], staff: [staff] });
    if (path === "/api/branches/1") { current = { ...current, ...body }; return Response.json({ success: true, branch: current }); }
    if (path === "/api/branches/1/assignments" && method === "POST") memberships = [{ userId: 2, branchId: 1, isPrimary: body.isPrimary, createdAt: "", updatedAt: "", staff }];
    if (path === "/api/branches/1/assignments/2" && method === "PATCH") memberships = memberships.map((item) => ({ ...item, isPrimary: true }));
    if (path === "/api/branches/1/assignments/2" && method === "DELETE") memberships = [];
    return Response.json({ success: true, assignments: memberships });
  };
  const cleanup = await render("administrator");
  try {
    assert.match(document.body.textContent ?? "", /Main Branch/);
    await click("Deactivate");
    assert.match(document.body.textContent ?? "", /Inactive/);
    assert.deepEqual(mutations[0].body, { status: "inactive" });
    await click("Activate");
    assert.equal(current.address, "Road");
    await click("Edit");
    await act(async () => document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(mutations.at(-1)?.method, "PATCH");
    await click("Manage staff");
    const select = document.querySelector("select")!;
    await act(async () => { select.value = "2"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await act(async () => document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.match(document.body.textContent ?? "", /Mae Manager/);
    assert.deepEqual(mutations.at(-1)?.body, { userId: 2, isPrimary: false });
    await click("Set primary");
    assert.match(document.body.textContent ?? "", /Primary branch/);
    await click("Remove");
    assert.match(document.body.textContent ?? "", /No assigned Managers or Front Desk/);
    assert.equal(mutations.at(-1)?.method, "DELETE");
  } finally { await cleanup(); globalThis.fetch = previous; }
});

test("Administrator sees and edits the receipt TIN on the Branches screen", async () => {
  const previous = globalThis.fetch;
  let current: Branch = { ...branch, tin: "123-456-789-000" };
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/api/branches") return Response.json({ success: true, branches: [current], staff: [staff] });
    if (path === "/api/branches/1") { bodies.push(body); current = { ...current, ...body }; return Response.json({ success: true, branch: current }); }
    return Response.json({ success: true, assignments: [] });
  };
  const cleanup = await render("administrator");
  try {
    assert.match(document.body.textContent ?? "", /TIN123-456-789-000/);
    await click("Edit");
    const field = [...document.querySelectorAll("label")].find((label) => label.textContent?.includes("TIN (printed on receipts)"))?.querySelector("input");
    assert.ok(field, "The branch form has a TIN field");
    assert.equal(field.value, "123-456-789-000");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, "987-654-321-000");
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(bodies.at(-1)?.tin, "987-654-321-000");
    assert.match(document.body.textContent ?? "", /TIN987-654-321-000/);
  } finally { await cleanup(); globalThis.fetch = previous; }
});
