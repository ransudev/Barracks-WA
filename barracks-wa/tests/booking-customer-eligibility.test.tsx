import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import type { ApiCustomer } from "@/app/lib/api";
import type { BookingFormValue } from "@/app/components/bookings/BookingForm";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BookingForm } = await import("@/app/components/bookings/BookingForm");
const registered: ApiCustomer = { id: 1, userId: 10, firstName: "Registered", lastName: "Customer", email: "registered@test.local", phone: "", preferredBarberId: null, preferredBarberName: null, loyaltyPoints: 0, createdAt: "", updatedAt: "" };
const walkIn: ApiCustomer = { ...registered, id: 2, userId: null, firstName: "Accountless", email: "" };

test("appointment picker excludes accountless profiles, submits eligible selection, and blocks invalid/stale selections", async () => {
  const previous = globalThis.fetch;
  // Submission requires the chosen time to be open in the month availability.
  const { manilaToday } = await import("@/app/constants/booking");
  const date = manilaToday();
  globalThis.fetch = async (input) => Response.json({ success: true, days: new URL(String(input), "http://localhost").searchParams.get("month") === date.slice(0, 7)
    ? [{ date, openSlots: 1, times: [{ startTime: "10:00", endTime: "10:45", available: true }] }] : [] });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  let value: BookingFormValue = { customerId: "1", serviceId: "barracks-basic", barberId: "", date, time: "10:00", notes: "" };
  let submissions = 0;
  let changes: BookingFormValue[] = [];
  const render = async (customers: ApiCustomer[], hideCustomer = false) => {
    await act(async () => root.render(<BookingForm value={value} customers={customers} hideCustomer={hideCustomer}
      services={[{ id: "barracks-basic", name: "Basic", price: 300, durationMinutes: 45, active: true, description: "" }]} barbers={[]}
      onChange={(next) => { changes.push(next); }} onCancel={() => undefined}
      onSubmit={(event) => { event.preventDefault(); submissions++; }} />));
  };
  const submit = async () => {
    const form = container.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  };
  const button = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  try {
    await render([walkIn, registered]);
    const customer = container.querySelector<HTMLSelectElement>("select")!;
    assert.equal(customer.querySelector('option[value="2"]'), null);
    assert.equal(customer.querySelector('option[value="1"]')?.textContent, "Registered Customer");
    assert.equal(button().disabled, false);
    await submit(); assert.equal(submissions, 1);

    // A parent still holding the stale value cannot submit, even before it
    // accepts the form's clearing callback or through a direct submit event.
    for (const customers of [[{ ...registered, userId: null }], []]) {
      changes = [];
      await render(customers);
      assert.equal(button().disabled, true);
      assert.equal(changes.at(-1)?.customerId, "");
      assert.equal(changes.at(-1)?.time, "10:00");
      await submit(); assert.equal(submissions, 1);
    }
    for (const customerId of ["2", "999", "", "01"]) {
      value = { ...value, customerId };
      await render([registered, walkIn]);
      assert.equal(button().disabled, true);
      await submit(); assert.equal(submissions, 1);
    }
    value = { ...value, customerId: "1" };
    await render([registered]);
    assert.equal(button().disabled, false);
    await submit(); assert.equal(submissions, 2);

    // Both signed-in customer consumers hide the picker and obtain ownership
    // from their server session, rather than a staff customer collection.
    value = { ...value, customerId: "" };
    changes = [];
    await render([], true);
    assert.equal(container.querySelector('option[value="1"]'), null);
    assert.equal(button().disabled, false);
    assert.deepEqual(changes, []);
    await submit(); assert.equal(submissions, 3);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = previous; }
});
