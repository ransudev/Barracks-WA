import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { EligibleVisit, TransactionRecord } from "@/server/services/payment.service";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PaymentPage } = await import("@/app/pages/staff/PaymentPage");

const booking: EligibleVisit = { branchId: 1, visitType: "booking", visitRecordId: 11, customerName: "Ava Client", serviceName: "Original cut", barberName: "Bea Barber", servicePrice: 425, total: 425 };
const walkIn: EligibleVisit = { branchId: 1, visitType: "queue", visitRecordId: 12, customerName: "Will Walkin", serviceName: "Basic cut", barberName: "Bea Barber", servicePrice: 300, total: 300 };
const paid: TransactionRecord = { branchId: 1, id: 1, reference: "TX-TEST", visitType: "booking", visitRecordId: 11, bookingId: 11, queueEntryId: null,
  customerId: 2, barberId: 3, serviceId: "cut", processedBy: 4, customerName: "Ava Client", barberName: "Bea Barber", cashierName: "Pat Cashier",
  serviceName: "Original cut", amount: 425, subtotal: 425, total: 425, paymentMethod: "cash", amountReceived: 500, change: 75,
  status: "completed", paymentStatus: "completed", createdAt: new Date().toISOString() };

async function renderPayment({ canCheckout = true, canManageFinancialActions = false }: { canCheckout?: boolean; canManageFinancialActions?: boolean } = {}) {
  const previousFetch = globalThis.fetch;
  let visits = [booking, walkIn];
  let history: TransactionRecord[] = [];
  let historyTotal = 0;
  const posts: Record<string, unknown>[] = [];
  const requests: string[] = [];
  const branchRequests: string[] = [];
  let postResponse: Response | null = null;
  let receiptRecord = paid;
  let releasePost: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input, init) => {
    const rawPath = String(input);
    branchRequests.push(rawPath);
    if (rawPath === "/api/branch-context") return Response.json({ branches: [{ id: 1, name: "Main Branch", status: "active" }, { id: 2, name: "Second Branch", status: "active" }], primaryBranch: { id: 1 } });
    if (rawPath.includes("branchId=2") && rawPath.includes("view=eligible")) return Response.json({ success: true, visits: [{ ...walkIn, branchId: 2, customerName: "Second Visit" }] });
    if (rawPath.includes("branchId=2") && rawPath.includes("view=history")) return Response.json({ success: true, transactions: [{ ...paid, branchId: 2, reference: "TX-SECOND", customerName: "Second Sale" }], total: 1, totalPages: 1 });
    const path = rawPath.replace(/&branchId=\d+/, "");
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/transactions?view=eligible") return Response.json({ success: true, visits });
    if (path.startsWith("/api/transactions?view=history")) return Response.json({ success: true, transactions: history, total: historyTotal || history.length, totalPages: Math.ceil((historyTotal || history.length) / 100) });
    if (path.startsWith("/api/transactions?reference=")) return Response.json({ success: true, transaction: receiptRecord });
    if (path === "/api/transactions" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (postResponse) return postResponse;
      return new Promise<Response>((resolve) => { releasePost = resolve; });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PaymentPage onToast={() => undefined} canCheckout={canCheckout} canManageFinancialActions={canManageFinancialActions} />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  return { container, posts, requests, branchRequests, setVisits: (next: EligibleVisit[]) => { visits = next; },
    setHistory: (next: TransactionRecord[]) => { history = next; },
    setHistoryTotal: (next: number) => { historyTotal = next; },
    setReceipt: (next: TransactionRecord) => { receiptRecord = next; },
    setPostResponse: (response: Response) => { postResponse = response; },
    releasePost: (response: Response) => releasePost?.(response),
    cleanup: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch; } };
}

async function choose(container: HTMLElement, value: string) {
  const name = value === "booking:11" ? "Ava Client" : "Will Walkin";
  const button = [...container.querySelectorAll<HTMLButtonElement>(".eligible-visit-list button")].find((item) => item.textContent?.includes(name));
  assert.ok(button, `Missing eligible visit ${name}`);
  await act(async () => button.click());
}
async function setMethod(container: HTMLElement, value: string) {
  const select = container.querySelector('.payment-form-panel select') as HTMLSelectElement;
  await act(async () => { select.value = value; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
}
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
const submit = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Complete payment"))!;

async function openDay(container: HTMLElement) {
  const day = [...container.querySelectorAll<HTMLButtonElement>(".transaction-calendar__day")].find((button) => /[1-9]\d* transactions?$/.test(button.getAttribute("aria-label") ?? ""));
  assert.ok(day, "A transaction date must exist");
  await act(async () => day.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
}
async function confirmPayment(container: HTMLElement) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Confirm payment");
  assert.ok(button, "Payment requires explicit confirmation");
  await act(async () => { button.click(); button.click(); });
}

test("Front Desk checkout has no refund or void controls", async () => {
  const page = await renderPayment({ canCheckout: true });
  try {
    page.setHistory([paid]);
    page.setReceipt({ ...paid, status: "refunded", paymentStatus: "refunded", actions: undefined });
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); });
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.ok(dom.window.document.querySelector(".payment-form-panel"));
    assert.equal(dom.window.document.querySelector(".financial-action-panel"), null);
    assert.equal(dom.window.document.querySelector(".financial-audit-panel"), null);
    assert.match(dom.window.document.querySelector(".receipt-paper")?.textContent ?? "", /refunded/);
    assert.equal(dom.window.document.body.textContent?.includes("Refund full amount"), false);
    assert.equal(dom.window.document.body.textContent?.includes("Void transaction"), false);
  } finally { await page.cleanup(); }
});

test("Management sees transaction history and financial controls without checkout", async () => {
  const page = await renderPayment({ canCheckout: false, canManageFinancialActions: true });
  try {
    assert.equal(dom.window.document.querySelector(".payment-form-panel"), null);
    assert.equal(dom.window.document.body.textContent?.includes("Complete payment"), false);
    assert.equal(page.requests.some((request) => request.includes("view=eligible")), false);
    page.setHistory([paid]);
    page.setReceipt({ ...paid, voidable: true });
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); });
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.match(dom.window.document.querySelector(".financial-action-panel")?.textContent ?? "", /Refund full amount[\s\S]*Void transaction/);
  } finally { await page.cleanup(); }
});

test("Management cannot void a sale that has earned commission, only refund it", async () => {
  const page = await renderPayment({ canCheckout: false, canManageFinancialActions: true });
  try {
    page.setHistory([paid]);
    page.setReceipt({ ...paid, voidable: false });
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); });
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    const panel = dom.window.document.querySelector(".financial-action-panel")?.textContent ?? "";
    assert.match(panel, /Refund full amount/);
    assert.match(panel, /can be refunded but not voided/);
    assert.equal(panel.includes("Void transaction"), false);
  } finally { await page.cleanup(); }
});

test("cash checkout requires sufficient received amount, submits once, and refreshes server history", async () => {
  const page = await renderPayment();
  const previousPrint = dom.window.print;
  let printCount = 0;
  dom.window.print = () => { printCount++; };
  try {
    await choose(page.container, "booking:11");
    assert.match(dom.window.document.body.textContent ?? "", /Ava Client.*Original cut.*Bea Barber[\s\S]*₱425/);
    assert.equal(submit(page.container).disabled, true);
    const input = dom.window.document.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "400"); });
    assert.equal(submit(page.container).disabled, true);
    await act(async () => { setInputValue(input, "500"); });
    assert.match(dom.window.document.body.textContent ?? "", /Change: ₱75/);
    await act(async () => { submit(page.container).click(); });
    assert.equal(page.posts.length, 0);
    await confirmPayment(page.container);
    assert.equal(page.posts.length, 1);
    assert.deepEqual(page.posts[0], { visit: { bookingId: 11 }, paymentMethod: "cash", amountReceived: 500 });
    assert.equal(dom.window.document.body.textContent?.includes("Processing…"), true);
    page.setVisits([walkIn]); page.setHistory([paid]);
    await act(async () => { page.releasePost(Response.json({ success: true, transaction: paid }, { status: 201 })); });
    assert.match(dom.window.document.body.textContent ?? "", /Payment completed.*TX-TEST[\s\S]*Received: ₱500[\s\S]*Change: ₱75/);
    assert.match(dom.window.document.body.textContent ?? "", /1 transactions this month/);
    assert.equal(page.requests.filter((request) => request === "GET /api/transactions?view=eligible").length, 2);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Print Receipt")!.click(); });
    assert.ok(page.requests.includes("GET /api/transactions?reference=TX-TEST"));
    assert.equal(printCount, 1);
  } finally { dom.window.print = previousPrint; await page.cleanup(); }
});

test("non-cash checkout omits cash fields and shows duplicate conflict", async () => {
  const page = await renderPayment();
  try {
    await choose(page.container, "queue:12");
    await setMethod(page.container, "e_wallet");
    assert.equal(dom.window.document.querySelector('input[type="number"]'), null);
    page.setPostResponse(Response.json({ success: false, message: "A transaction already exists for this visit" }, { status: 409 }));
    await act(async () => { submit(page.container).click(); });
    await confirmPayment(page.container);
    assert.deepEqual(page.posts[0], { visit: { queueEntryId: 12 }, paymentMethod: "e_wallet" });
    assert.match(dom.window.document.body.textContent ?? "", /A transaction already exists for this visit/);
    assert.equal(page.requests.filter((request) => request === "GET /api/transactions?view=eligible").length, 2);
  } finally { await page.cleanup(); }
});

test("receipt reopens from the server and prints persisted snapshots", async () => {
  const page = await renderPayment();
  const previousPrint = dom.window.print;
  let printCount = 0;
  dom.window.print = () => { printCount++; };
  try {
    page.setHistory([paid]);
    const refresh = Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!;
    await act(async () => { refresh.click(); });
    const snapshot = { ...paid, customerName: "Saved Customer", serviceName: "Saved Service", barberName: "Saved Barber", cashierName: "Saved Cashier", subtotal: 425, total: 425 };
    page.setReceipt(snapshot);
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    const receipt = dom.window.document.querySelector(".receipt-paper")!;
    assert.match(receipt.textContent ?? "", /TX-TEST[\s\S]*Saved Customer[\s\S]*Saved Service[\s\S]*Saved Barber[\s\S]*Saved Cashier[\s\S]*Subtotal₱425[\s\S]*Total₱425[\s\S]*Amount received₱500[\s\S]*Change₱75[\s\S]*completed/);
    assert.ok(page.requests.includes("GET /api/transactions?reference=TX-TEST"));
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Print Receipt")!.click(); });
    assert.equal(printCount, 1);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Close receipt")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 270)));
    assert.equal(dom.window.document.querySelector(".receipt-paper"), null);
  } finally { dom.window.print = previousPrint; await page.cleanup(); }
});

test("history sends search, method and month filters and paginates a selected day", async () => {
  const page = await renderPayment();
  try {
    page.setHistory(Array.from({ length: 25 }, (_, index) => ({ ...paid, id: index + 1, reference: `TX-${index + 1}` })));
    await act(async () => { [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Refresh")!.click(); });
    const search = dom.window.document.querySelector('.transaction-filters input[aria-label="Reference or customer"]') as HTMLInputElement;
    assert.ok(search instanceof dom.window.HTMLInputElement, "history search is rendered and accessible by its label");
    await act(async () => setInputValue(search, "Ava"));
    await act(async () => { dom.window.document.querySelector(".transaction-filters")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    const method = dom.window.document.querySelector('.transaction-filters select') as HTMLSelectElement;
    await act(async () => { method.value = "cash"; method.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    const last = page.requests.at(-1)!;
    assert.match(last, /view=history&page=1&pageSize=100/);
    assert.match(last, /search=Ava/);
    assert.match(last, /paymentMethod=cash/);
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
    assert.ok(last.includes(`dateFrom=${month}-01`));
    assert.match(last, /dateTo=\d{4}-\d{2}-\d{2}/);
    await openDay(page.container);
    assert.equal(dom.window.document.querySelectorAll(".transaction-day-list li").length, 20);
    await act(async () => { [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Next")!.click(); });
    assert.equal(dom.window.document.querySelectorAll(".transaction-day-list li").length, 5);
    assert.match(dom.window.document.body.textContent ?? "", /Page 2 of 2/);
  } finally { await page.cleanup(); }
});

test("refunded receipt and history display the status and saved audit details", async () => {
  const page = await renderPayment({ canCheckout: false, canManageFinancialActions: true });
  try {
    const refunded: TransactionRecord = { ...paid, status: "refunded", paymentStatus: "refunded", actions: [{
      id: 7, transactionId: paid.id, action: "refund", amount: 425, reason: "Customer request",
      staffId: 8, staffName: "Morgan Manager", createdAt: new Date().toISOString(),
    }] };
    page.setHistory([refunded]); page.setReceipt(refunded);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); });
    await openDay(page.container);
    assert.match(dom.window.document.querySelector(".transaction-day-list")?.textContent ?? "", /refunded/);
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.match(dom.window.document.querySelector(".receipt-paper")?.textContent ?? "", /refunded[\s\S]*Refund₱425 · Customer request · Morgan Manager/);
    assert.match(dom.window.document.querySelector(".financial-audit-panel")?.textContent ?? "", /refund · ₱425 · Customer request · Morgan Manager/);
  } finally { await page.cleanup(); }
});

test("switching payment branches reloads visits/history and clears the previous receipt", async () => {
  const page = await renderPayment();
  try {
    page.setHistory([paid]);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); });
    await openDay(page.container);
    await act(async () => { Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === "View details")!.click(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.ok(dom.window.document.querySelector(".receipt-paper"));
    const branch = dom.window.document.querySelector("select")!;
    await act(async () => { branch.value = "2"; branch.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.match(dom.window.document.querySelector(".eligible-visits-panel")?.textContent ?? "", /Second Visit/);
    await openDay(page.container);
    assert.match(dom.window.document.querySelector(".transaction-day-list")?.textContent ?? "", /Second Sale/);
    assert.doesNotMatch(dom.window.document.querySelector(".transaction-day-list")?.textContent ?? "", /Ava Client/);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 270)));
    assert.equal(dom.window.document.querySelector(".receipt-paper"), null);
    assert.ok(page.branchRequests.some((path) => path.includes("view=history") && path.includes("branchId=2")));
  } finally { await page.cleanup(); }
});
