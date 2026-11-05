import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { ApiUser } from "@/app/lib/api";
import type { PayrollDetail, PayrollOverview, PayrollRecord } from "@/app/types/payroll";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/admin/payroll" });
const document = dom.window.document;
Object.assign(globalThis, { document, window: dom.window, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PageRouter } = await import("@/app/pages/PageRouter");

const user: ApiUser = { id: 1, firstName: "Mae", lastName: "Manager", email: "mae@example.test", role: "manager", isVerified: true, isBlocked: false, isActive: true, createdAt: "", updatedAt: "" };
const baseRecord: PayrollRecord = {
  id: "7", branch_id: 1, barber_id: 3, supplemental_to: null, barber_name: "Bea Barber", branch_name: "Main Branch",
  period_start: "2026-10-05", period_end_exclusive: "2026-10-19", status: "draft", gross_centavos: "150000", adjustments_centavos: "0",
  payable_centavos: "150000", service_count: 4, approved_by: null, approver_name: null, approved_at: null, paid_at: null,
};

function payrollServer() {
  let record = { ...baseRecord };
  const commands: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const overview = (): PayrollOverview => ({
    settings: { anchor_date: "2026-10-05" }, today: "2026-11-05", currentPeriod: { start: "2026-11-02", end: "2026-11-16" }, records: [record],
    summary: { total_records: 1, barbers: 1, pending: 0, paid: 0, payable_centavos: record.payable_centavos },
    rates: [{ id: 3, first_name: "Bea", last_name: "Barber", current_rate: "55.00", history: [] }], unresolved: [], periods: [], page: 1,
    barbers: [{ id: 3, name: "Bea Barber" }], corrections: [], currentEarnings: [], unassigned: { service_count: 0, gross_centavos: "0", before_calendar: 0 },
  });
  const detail = (): PayrollDetail => ({
    record, entries: [], adjustments: [], payment: null,
    events: [{ id: "1", action: "generated", reason: null, actor_name: "Mae Manager", created_at: "2026-10-20T01:00:00Z" }],
  });
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/branch-context") return Response.json({ success: true, branches: [{ id: 1, name: "Main Branch", status: "active" }], primaryBranch: { id: 1, name: "Main Branch", status: "active" } });
    assert.ok(path.startsWith("/api/payroll"), `Unexpected request ${path}`);
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      commands.push(command);
      const next = ({ submit: "pending_approval", approve: "approved", pay: "paid" } as Record<string, PayrollRecord["status"]>)[command.action];
      if (next) record = { ...record, status: next };
      return Response.json({ success: true, message: `${command.action} recorded` });
    }
    queries.push(path);
    return Response.json({ success: true, ...(path.includes("recordId=") ? detail() : overview()) });
  };
  return { fetchMock, commands, queries };
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const body = () => document.body.textContent ?? "";
const button = (text: string) => {
  const match = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  assert.ok(match, `Missing button: ${text}`);
  return match;
};
const click = async (text: string) => { await act(async () => button(text).click()); await settle(); };
const field = (label: string) => {
  const match = [...document.querySelectorAll("label")].find((item) => item.textContent?.includes(label));
  const input = match?.querySelector("input, select");
  assert.ok(input, `Missing field: ${label}`);
  return input as HTMLInputElement;
};
const type = async (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};

async function renderPayroll(role: ApiUser["role"]) {
  const server = payrollServer();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = server.fetchMock as typeof fetch;
  const toasts: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PageRouter view="admin-payroll" go={() => undefined} onToast={(message) => toasts.push(message)} currentUser={{ ...user, role }} />);
  });
  await settle();
  await settle();
  return {
    ...server,
    toasts,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      globalThis.fetch = previousFetch;
    },
  };
}

test("a manager moves a payroll record from draft through approval to paid", async () => {
  const page = await renderPayroll("manager");
  try {
    assert.match(body(), /Bea Barber/);
    await click("Review");
    assert.ok(page.queries.some((query) => query.includes("recordId=7")));
    assert.match(body(), /Payroll breakdown #7/);
    assert.match(body(), /generated/i);

    await click("Submit for approval");
    await click("Confirm");
    assert.deepEqual(page.commands.at(-1), { action: "submit", branchId: 1, recordId: 7 });
    assert.ok(page.toasts.includes("submit recorded"));

    await click("Approve payroll");
    await click("Approve and lock");
    assert.deepEqual(page.commands.at(-1), { action: "approve", branchId: 1, recordId: 7 });

    await click("Record full payment");
    await type(field("Payment method"), "bank_transfer");
    await type(field("Reference"), "BANK-1");
    await click("Confirm paid");
    const payment = page.commands.at(-1)!;
    assert.equal(payment.action, "pay");
    assert.equal(payment.paymentMethod, "bank_transfer");
    assert.equal(payment.reference, "BANK-1");
    assert.ok(Date.parse(String(payment.paidAt)));

    assert.match(body(), /Payslip #7/);
    assert.ok(button("Download payslip"));
    await click("Back to payroll");
    assert.ok(document.querySelector(".payroll-filters"));
  } finally {
    await page.cleanup();
  }
});

test("adjustments convert pesos to centavos and reject invalid amounts", async () => {
  const page = await renderPayroll("manager");
  try {
    await click("Review");
    await click("Add adjustment");
    await type(field("Adjustment (PHP"), "12.345");
    await type(field("Reason"), "Correction");
    await click("Confirm");
    assert.match(body(), /up to two decimal places/);
    assert.equal(page.commands.length, 0);

    await type(field("Adjustment (PHP"), "-12.5");
    await click("Confirm");
    assert.deepEqual(page.commands.at(-1), { action: "adjust", branchId: 1, recordId: 7, amountCentavos: "-1250", reason: "Correction" });
  } finally {
    await page.cleanup();
  }
});

test("filters reset paging, the rate dialog starts from the current rate, and only managers approve", async () => {
  const page = await renderPayroll("administrator");
  try {
    await type(document.querySelector('.payroll-filters select[aria-label="Status"]') as HTMLSelectElement, "draft");
    await settle();
    assert.ok(page.queries.at(-1)!.includes("status=draft"));
    assert.ok(page.queries.at(-1)!.includes("page=1"));

    await click("Commission settings");
    assert.match(body(), /First period starts 2026-10-05/);
    await click("Set future rate");
    assert.equal(field("Commission rate").value, "55.00");
    await click("Cancel");

    await click("Overview");
    await click("Review");
    await click("Submit for approval");
    await click("Confirm");
    assert.ok(button("Return to draft"));
    assert.equal([...document.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Approve payroll"), false);
  } finally {
    await page.cleanup();
  }
});
