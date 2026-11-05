import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { ApiOperationalAvailability, ApiQueueEntry } from "@/app/lib/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueuePage } = await import("@/app/pages/staff/QueuePage");

const waiting: ApiQueueEntry = { branchId: 1, id: 7, bookingId: null, visitType: "walk_in", scheduledDate: null, scheduledTime: null, bookingStatus: null, customerId: 3, customerName: "Next Customer", serviceId: "cut",
  serviceName: "Basic Cut", barberId: null, barberName: null, status: "waiting", joinedAt: "2026-09-27T02:00:00Z",
  startedAt: null, completedAt: null, createdAt: "2026-09-27T02:00:00Z", updatedAt: "2026-09-27T02:00:00Z" };

async function renderQueue(candidate: ApiQueueEntry | null, holdQueuePost = false, completed: ApiQueueEntry[] = [], operationalAvailability?: ApiOperationalAvailability) {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  const branchRequests: string[] = [];
  const postedBodies: Record<string, unknown>[] = [];
  let releaseQueuePost: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input, init) => {
    const rawPath = String(input);
    branchRequests.push(rawPath);
    if (rawPath === "/api/branch-context") return Response.json({ branches: [{ id: 1, name: "Main Branch", status: "active" }, { id: 2, name: "Second Branch", status: "active" }], primaryBranch: { id: 1 } });
    if (rawPath === "/api/queue?view=active&branchId=2") return Response.json({ success: true, queue: [] });
    const path = rawPath.replace(/([?&])branchId=\d+&?/, "$1").replace(/[?&]$/, "");
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/queue?view=active") return Response.json({ success: true, queue: candidate ? [candidate] : [] });
    if (path === "/api/queue?view=completed-today") return Response.json({ success: true, queue: completed });
    if (path === "/api/customers") return Response.json({ success: true, customers: [{ id: 3, userId: 8, firstName: "Next", lastName: "Customer", email: "next@test.local", phone: "", preferredBarberId: null, preferredBarberName: null, loyaltyPoints: 0, createdAt: "2026-09-27T02:00:00Z", updatedAt: "2026-09-27T02:00:00Z" }] });
    if (path === "/api/services") return Response.json({ success: true, services: [{ id: "cut", name: "Basic Cut", active: true, durationMinutes: 45 }] });
    if (path === "/api/barbers") return Response.json({ success: true, barbers: [{ id: 1, firstName: "Test", lastName: "Barber", status: "available", operationalAvailability }] });
    if (path === "/api/queue/next?barberId=1") return Response.json({ success: true, entry: candidate, message: candidate ? null : "No eligible customer is waiting for this barber." });
    if (path === "/api/queue/next" && init?.method === "POST") return Response.json({ success: true, entry: { ...waiting, status: "ready", barberId: 1, barberName: "Test Barber" } });
    if (path === "/api/queue" && init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      postedBodies.push(payload);
      const newCustomer = payload.customer as { firstName: string; lastName: string } | undefined;
      const name = newCustomer ? `${newCustomer.firstName} ${newCustomer.lastName}` : "Next Customer";
      const entry = { ...waiting, id: 8, customerId: newCustomer ? 4 : 3, customerName: name, status: payload.barberId ? "ready" : "waiting", barberId: payload.barberId ?? null, barberName: payload.barberId ? "Test Barber" : null };
      const response = Response.json({ success: true, entry });
      if (holdQueuePost) return await new Promise<Response>((resolve) => { releaseQueuePost = resolve; });
      return response;
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<QueuePage onToast={() => undefined} />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return { container, requests, branchRequests, postedBodies, releaseQueuePost: (response: Response) => releaseQueuePost?.(response), cleanup: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch; } };
  } catch (error) {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch;
    throw error;
  }
}

test("Queue shows the authoritative clock-out reason and prevents a manual service start", async () => {
  const view = await renderQueue({ ...waiting, status: "ready", barberId: 1, barberName: "Test Barber" }, false, [],
    { available: false, reason: "clocked_out", activeQueueEntryId: null, attendanceState: "clocked_out" });
  try {
    const option = view.container.querySelector('.queue-next__controls option[value="1"]');
    assert.equal(option, null, "clocked-out barber is excluded from suggested assignments");
    await act(async () => { (view.container.querySelector(".operational-card__main") as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const start = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Start Service");
    assert.ok(start);
    assert.equal(start.disabled, true);
    assert.match(view.container.querySelector(".operational-drawer")?.textContent ?? "", /Clocked out/);
    await act(async () => start.click());
    assert.equal(view.requests.some((request) => request.startsWith("PATCH")), false);
  } finally { await view.cleanup(); }
});

test("completed-today entries show service details without active actions", async () => {
  const finished: ApiQueueEntry = { ...waiting, id: 9, customerName: "Finished Customer", status: "completed",
    barberId: 1, barberName: "Test Barber", startedAt: "2026-09-27T02:00:00Z", completedAt: "2026-09-27T02:30:00Z" };
  const booked: ApiQueueEntry = { ...finished, id: 10, customerName: "Booked Customer", bookingId: 20,
    visitType: "appointment", scheduledDate: "2026-09-27", scheduledTime: "10:30:00", bookingStatus: "completed" };
  const view = await renderQueue(waiting, false, [finished, booked]);
  try {
    assert.equal(view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "Active");
    const tab = Array.from(view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === "Completed Today")!;
    await act(async () => { tab.click(); });
    assert.ok(view.requests.includes("GET /api/queue?view=completed-today"));
    const panel = view.container.querySelector('[role="tabpanel"]')!;
    for (const detail of ["Finished Customer", "Basic Cut", "Test Barber", "Walk-in", "Sep", "10:00", "10:30"])
      assert.ok(panel.textContent?.includes(detail), detail);
    assert.equal(panel.querySelectorAll(".badge").length, 2);
    assert.match(panel.textContent ?? "", /Booked Customer.*Appointment/);
    assert.equal(view.container.querySelector(".queue-next-panel"), null);
    assert.equal(view.container.querySelector(".operational-drawer__actions"), null);
    assert.equal(panel.querySelectorAll("button").length, 0);
  } finally { await view.cleanup(); }
});

test("active appointment shows visit badge and scheduled time in cards, list, drawer, and Next Customer", async () => {
  const appointment: ApiQueueEntry = { ...waiting, id: 11, bookingId: 20, visitType: "appointment",
    customerName: "Booked Customer", barberId: 1, barberName: "Test Barber", status: "ready",
    scheduledDate: "2026-09-27", scheduledTime: "10:30:00", bookingStatus: "checked_in" };
  const view = await renderQueue(appointment);
  try {
    const card = view.container.querySelector(".operational-card-grid")!;
    assert.match(card.textContent ?? "", /Appointment.*10:30 AM/);
    const listButton = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "List")!;
    await act(async () => { listButton.click(); });
    assert.match(view.container.querySelector(".operational-panel table")?.textContent ?? "", /Appointment.*10:30 AM/);
    const row = view.container.querySelector<HTMLTableRowElement>(".operational-panel tbody tr")!;
    await act(async () => { row.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(view.container.querySelector(".operational-drawer")?.textContent ?? "", /Appointment.*10:30 AM/);
    assert.match(view.container.querySelector(".operational-drawer")?.textContent ?? "", /checked in/);
    assert.equal(view.container.querySelector(".operational-drawer__actions"), null, "booking lifecycle stays in Bookings");
    await selectBarberAndSuggest(view.container);
    const suggestion = view.container.querySelector(".queue-next__suggestion")?.textContent ?? "";
    assert.match(suggestion, /Checked-in appointment/);
    assert.match(suggestion, /Appointment.*10:30 AM/);
  } finally { await view.cleanup(); }
});

async function selectBarberAndSuggest(container: HTMLElement) {
  const select = container.querySelector<HTMLSelectElement>(".queue-next__controls select")!;
  await act(async () => { select.value = "1"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".queue-next__controls button"))[0];
  await act(async () => { button.click(); });
}

test("front desk reviews and confirms assignment without starting service", async () => {
  const view = await renderQueue(waiting);
  try {
    assert.match(view.container.querySelector(".operational-card-grid .queue-visit-type")?.textContent ?? "", /Walk-in/);
    await selectBarberAndSuggest(view.container);
    const summary = view.container.querySelector(".queue-next__suggestion")?.textContent ?? "";
    for (const detail of ["Next Customer", "Basic Cut", "Walk-in", "Unassigned"]) assert.ok(summary.includes(detail));
    assert.equal(view.requests.some((request) => request.startsWith("POST ")), false, "suggestion is read-only");
    const assign = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".queue-next__suggestion button")).find((button) => button.textContent?.includes("Assign barber"))!;
    await act(async () => { assign.click(); });
    assert.ok(view.requests.includes("POST /api/queue/next"));
    assert.equal(view.requests.some((request) => request.includes("/api/queue/7")), false, "service start is a separate action");
    assert.match(view.container.querySelector(".queue-next__suggestion")?.textContent ?? "", /Test Barber/);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(view.container.textContent ?? "", /Start Service/);
  } finally { await view.cleanup(); }
});

test("front desk sees a clear empty suggestion", async () => {
  const view = await renderQueue(null);
  try {
    await selectBarberAndSuggest(view.container);
    assert.match(view.container.querySelector(".queue-next__message")?.textContent ?? "", /No eligible customer is waiting/);
    assert.equal(view.container.querySelector(".queue-next__suggestion"), null);
  } finally { await view.cleanup(); }
});

test("front desk creates a walk-in customer and queues them without leaving the Queue page", async () => {
  const view = await renderQueue(null);
  try {
    const addButton = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Add to queue")!;
    await act(async () => { addButton.click(); });
    const form = view.container.querySelector<HTMLFormElement>(".modal-form")!;
    const selects = form.querySelectorAll<HTMLSelectElement>("select");
    await act(async () => {
      selects[0].value = "new";
      selects[0].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    const fields = form.querySelectorAll<HTMLInputElement>("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(fields[0], "Walk");
      fields[0].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      fields[0].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(fields[1], "In");
      fields[1].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      fields[1].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      selects[2].value = "1";
      selects[2].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    const submit = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.type === "submit")!;
    await act(async () => { submit.click(); });
    assert.equal(view.postedBodies.length, 1);
    assert.deepEqual(view.postedBodies[0].customer, { firstName: "Walk", lastName: "In", phone: "" });
    assert.equal(view.postedBodies[0].serviceId, "cut");
    assert.equal(view.postedBodies[0].barberId, 1);
    assert.equal(typeof view.postedBodies[0].idempotencyKey, "string");
    assert.equal("email" in view.postedBodies[0], false);
    assert.equal("password" in view.postedBodies[0], false);
    assert.match(view.container.textContent ?? "", /Walk In/);
    assert.match(view.container.textContent ?? "", /Ready/);
  } finally { await view.cleanup(); }
});

test("Queue form blocks a rapid duplicate submission while the first request is pending", async () => {
  const view = await renderQueue(null, true);
  try {
    const addButton = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Add to queue")!;
    await act(async () => { addButton.click(); });
    const form = view.container.querySelector<HTMLFormElement>(".modal-form")!;
    const submit = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.type === "submit")!;
    await act(async () => { submit.click(); submit.click(); });
    assert.equal(view.postedBodies.length, 1);
    const payload = view.postedBodies[0];
    const body = payload.customerId ? waiting : { ...waiting, id: 8 };
    view.releaseQueuePost(Response.json({ success: true, entry: body }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  } finally { await view.cleanup(); }
});

test("queue branch switching reloads scoped data and clears the previous suggestion", async () => {
  const view = await renderQueue(waiting);
  try {
    await selectBarberAndSuggest(view.container);
    assert.ok(view.container.querySelector(".queue-next__suggestion"));
    const select = view.container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "2"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.ok(view.branchRequests.includes("/api/queue?view=active&branchId=2"));
    assert.ok(view.branchRequests.includes("/api/barbers?branchId=2"));
    assert.equal(view.container.querySelector(".queue-next__suggestion"), null);
    assert.doesNotMatch(view.container.querySelector(".operational-card-grid")?.textContent ?? "", /Next Customer/);
  } finally { await view.cleanup(); }
});
