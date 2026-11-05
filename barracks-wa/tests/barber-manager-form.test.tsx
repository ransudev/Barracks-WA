import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { ApiBarber } from "@/app/lib/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(globalThis, { self: dom.window });
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BarbersManagement } = await import("@/app/pages/admin/BarbersManagement");
const branch = { id: 1, name: "Main", code: "MAIN", address: "", phone: "", status: "active", createdAt: "", updatedAt: "" };
const barber: ApiBarber = { id: 8, branchId: 1, firstName: "Manager", lastName: "Barber", status: "available", commissionRate: null, earnedCommissionCentavos: "0", servicesDone: 0, revenue: 0, rating: null, scheduleDayCount: 7, createdAt: "", updatedAt: "" };

const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
  assert.ok(button, `Missing button ${label}`);
  await act(async () => button.click());
};

test("Manager barber form submits without commission or rating fields", async () => {
  const previousFetch = globalThis.fetch;
  const posts: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/branch-context") return Response.json({ branches: [branch], primaryBranch: branch });
    if (path === "/api/barbers?branchId=1" && !init?.method) return Response.json({ success: true, barbers: [] });
    if (path === "/api/barbers" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)); posts.push(body);
      return Response.json({ success: true, barber }, { status: 201 });
    }
    if (path === "/api/shop-hours?branchId=1") return Response.json({ success: true, hours: [] });
    throw new Error(`Unexpected request: ${path}`);
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(BarbersManagement, { onToast: () => undefined, canDelete: false, canEditCommission: false })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click("Add barber");
    assert.doesNotMatch(document.body.textContent ?? "", /Commission rate|Rating/);
    const labelled = [...document.querySelectorAll("label")];
    const first = labelled.find((label) => label.textContent?.includes("First name"))?.querySelector("input");
    const last = labelled.find((label) => label.textContent?.includes("Last name"))?.querySelector("input");
    assert.ok(first && last);
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
      setValue?.call(first, "New"); first.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      setValue?.call(last, "Barber"); last.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const form = [...document.querySelectorAll("form")].find((element) => element.querySelector("input"));
    assert.ok(form);
    await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(posts, [{ branchId: 1, firstName: "New", lastName: "Barber", status: "available" }]);
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch;
  }
});
