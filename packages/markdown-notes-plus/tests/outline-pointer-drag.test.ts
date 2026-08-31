/// <reference lib="deno.ns" />

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { captureOutlinePointer, createOutlineDragActivationGate, isOutlineDragPointer, outlineDropPlacement } from "../src/outline/OutlinePointerDrag.ts";

function fakeTimers() {
  let now = 0;
  const pending: { id: number; fn: () => void; at: number }[] = [];
  return {
    advance(ms: number) {
      now += ms;
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (pending[i].at <= now) {
          const job = pending.splice(i, 1)[0];
          job.fn();
        }
      }
    },
    setTimeout: (fn: () => void, ms: number) => {
      const id = pending.length + 1;
      pending.push({ id, fn, at: now + ms });
      return id;
    },
    clearTimeout: (id: number) => {
      const index = pending.findIndex((p) => p.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
  };
}

Deno.test("OutlinePointerDrag activates at the 250ms hold boundary", () => {
  const timers = fakeTimers();
  const gate = createOutlineDragActivationGate(timers.setTimeout, timers.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  timers.advance(240);
  gate.move(105, 204);
  timers.advance(9);
  if (events.length !== 0) throw new Error("must not activate early");
  timers.advance(1);
  if (events.join(",") !== "activated") throw new Error("small movement within tolerance must still activate");
});

Deno.test("OutlinePointerDrag cancels pending activation beyond 10px", () => {
  const timers = fakeTimers();
  const gate = createOutlineDragActivationGate(timers.setTimeout, timers.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  gate.move(111, 200);
  if (events.join(",") !== "cancelled") throw new Error("movement beyond tolerance must cancel");
  timers.advance(300);
  if (events.join(",") !== "cancelled") throw new Error("cancelled timer must not activate");
});

Deno.test("OutlinePointerDrag cancels when released before activation", () => {
  const timers = fakeTimers();
  const gate = createOutlineDragActivationGate(timers.setTimeout, timers.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  gate.up();
  timers.advance(300);
  if (events.join(",") !== "cancelled") throw new Error("early release must cancel");
});

Deno.test("OutlinePointerDrag does not retrigger after activation", () => {
  const timers = fakeTimers();
  const gate = createOutlineDragActivationGate(timers.setTimeout, timers.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  timers.advance(260);
  gate.move(150, 300);
  gate.move(200, 400);
  if (events.join(",") !== "activated") throw new Error("post-activation movement must not retrigger");
});

Deno.test("OutlinePointerDrag rejects events from a different pointer", () => {
  if (!isOutlineDragPointer(7, 7)) throw new Error("same pointer must be accepted");
  if (isOutlineDragPointer(7, 8)) throw new Error("different pointer must be rejected");
});

Deno.test("OutlinePointerDrag computes placement from the final pointer coordinate", () => {
  if (outlineDropPlacement(101, { top: 100, height: 20 }) !== "before") throw new Error("upper half must place before");
  if (outlineDropPlacement(119, { top: 100, height: 20 }) !== "after") throw new Error("lower half must place after");
});

Deno.test("OutlinePointerDrag cancellation does not activate the gate", () => {
  const timers = fakeTimers();
  const gate = createOutlineDragActivationGate(timers.setTimeout, timers.clearTimeout);
  let activated = false;
  gate.onActivate(() => { activated = true; });
  gate.onCancel(() => undefined);
  gate.start(10, 10);
  gate.up();
  timers.advance(250);
  if (activated) throw new Error("cancelled pointer must not activate");
});

Deno.test("OutlinePointerDrag reports pointer-capture failure without claiming success", () => {
  const failed = captureOutlinePointer({ setPointerCapture: () => { throw new Error("unsupported"); } }, 3);
  if (failed) throw new Error("capture failure must report false");
});
