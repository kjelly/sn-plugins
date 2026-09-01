function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { scrollToolbarWithWheel } from "../src/utils/toolbarWheel.ts";

function container(scrollLeft = 0) {
  return { clientWidth: 200, scrollLeft, scrollWidth: 500 };
}

Deno.test("toolbar wheel - vertical wheel scrolls an overflowing toolbar horizontally", () => {
  const toolbar = container(20);
  const consumed = scrollToolbarWithWheel(toolbar, { ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 60 });

  assertEquals(consumed, true);
  assertEquals(toolbar.scrollLeft, 80);
});

Deno.test("toolbar wheel - does not consume gestures that cannot move the toolbar", () => {
  const atStart = container(0);
  assertEquals(scrollToolbarWithWheel(atStart, { ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: -60 }), false);
  assertEquals(atStart.scrollLeft, 0);

  const noOverflow = { clientWidth: 200, scrollLeft: 0, scrollWidth: 200 };
  assertEquals(scrollToolbarWithWheel(noOverflow, { ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 60 }), false);
});

Deno.test("toolbar wheel - preserves horizontal touchpad gestures and browser zoom", () => {
  const toolbar = container(20);
  assertEquals(scrollToolbarWithWheel(toolbar, { ctrlKey: false, deltaMode: 0, deltaX: 80, deltaY: 20 }), false);
  assertEquals(scrollToolbarWithWheel(toolbar, { ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 60 }), false);
  assertEquals(toolbar.scrollLeft, 20);
});
