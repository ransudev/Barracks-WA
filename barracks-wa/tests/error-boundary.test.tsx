import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><div id=root></div>");
const document = dom.window.document;
Object.assign(globalThis, { document, window: dom.window, IS_REACT_ACT_ENVIRONMENT: true });

test("a crashing screen shows a recovery message until navigation clears it", async () => {
  const { ErrorBoundary } = await import("@/app/components/ErrorBoundary");
  const silenced = mock.method(console, "error", () => undefined);
  let broken = true;
  const Screen = () => {
    if (broken) throw new Error("boom");
    return <p>healthy</p>;
  };
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const render = (resetKey: string) => act(async () => {
    root.render(<ErrorBoundary resetKey={resetKey}><Screen /></ErrorBoundary>);
  });
  try {
    await render("/staff/queue");
    assert.match(container.textContent ?? "", /could not be displayed/);
    assert.ok(container.querySelector("[role=alert] button"));

    await render("/staff/queue");
    assert.match(container.textContent ?? "", /could not be displayed/);

    broken = false;
    await render("/staff/bookings");
    assert.equal(container.textContent, "healthy");
  } finally {
    silenced.mock.restore();
    await act(async () => root.unmount());
  }
});
