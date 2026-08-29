function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  parseRepeatInterval,
  calculateNextDueDate,
  isRecurringTaskOverdue,
  updateTaskTextForToggle,
  evaluateRecurringTasks,
} from "../src/tasks/RecurringTasks.ts";

Deno.test("RecurringTasks - parseRepeatInterval parses units and aliases", () => {
  assertEquals(parseRepeatInterval("3d"), { amount: 3, unit: "d" });
  assertEquals(parseRepeatInterval("5 days"), { amount: 5, unit: "d" });
  assertEquals(parseRepeatInterval("daily"), { amount: 1, unit: "d" });
  assertEquals(parseRepeatInterval("2w"), { amount: 2, unit: "w" });
  assertEquals(parseRepeatInterval("weekly"), { amount: 1, unit: "w" });
  assertEquals(parseRepeatInterval("1m"), { amount: 1, unit: "m" });
  assertEquals(parseRepeatInterval("monthly"), { amount: 1, unit: "m" });
  assertEquals(parseRepeatInterval("1y"), { amount: 1, unit: "y" });
  assertEquals(parseRepeatInterval("yearly"), { amount: 1, unit: "y" });
  assertEquals(parseRepeatInterval("invalid"), undefined);
});

Deno.test("RecurringTasks - calculateNextDueDate computes future dates", () => {
  const due = calculateNextDueDate("2026-08-20", "5d");
  assertEquals(due?.getFullYear(), 2026);
  assertEquals(due?.getMonth(), 7); // Aug
  assertEquals(due?.getDate(), 25);
});

Deno.test("RecurringTasks - isRecurringTaskOverdue compares dates correctly", () => {
  // Done on 2026-08-20 with repeat(5d) -> due on 2026-08-25
  const todayEarly = new Date(2026, 7, 24); // Aug 24
  const todayDue = new Date(2026, 7, 25); // Aug 25
  const todayLate = new Date(2026, 7, 29); // Aug 29

  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayEarly), false);
  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayDue), true);
  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayLate), true);
});

Deno.test("RecurringTasks - updateTaskTextForToggle appends @done on complete and removes on incomplete", () => {
  const fixedToday = new Date(2026, 7, 29); // 2026-08-29

  // Task with @repeat: complete adds @done
  assertEquals(
    updateTaskTextForToggle("Water plants @repeat(3d)", true, fixedToday),
    "Water plants @repeat(3d) @done(2026-08-29)",
  );

  // Task with @repeat: incomplete removes @done
  assertEquals(
    updateTaskTextForToggle("Water plants @repeat(3d) @done(2026-08-26)", false, fixedToday),
    "Water plants @repeat(3d)",
  );

  // Ordinary task without @repeat: no change
  assertEquals(
    updateTaskTextForToggle("Buy groceries", true, fixedToday),
    "Buy groceries",
  );
  assertEquals(
    updateTaskTextForToggle("Buy groceries", false, fixedToday),
    "Buy groceries",
  );
});

Deno.test("RecurringTasks - evaluateRecurringTasks resets overdue tasks only", () => {
  const input = `# Routine
- [x] Water plants @repeat(3d) @done(2026-08-20)
- [x] Weekly backup @repeat(1w) @done(2026-08-28)
- [x] Fixed completed task
- [ ] Open task @repeat(daily)
`;

  const today = new Date(2026, 7, 29); // Aug 29 (Water plants is due Aug 23, Weekly backup is due Sep 4)
  const result = evaluateRecurringTasks(input, today);

  assertEquals(result.changed, true);
  assertEquals(result.resetCount, 1);
  assertEquals(
    result.markdown,
    `# Routine
- [ ] Water plants @repeat(3d)
- [x] Weekly backup @repeat(1w) @done(2026-08-28)
- [x] Fixed completed task
- [ ] Open task @repeat(daily)
`,
  );
});
