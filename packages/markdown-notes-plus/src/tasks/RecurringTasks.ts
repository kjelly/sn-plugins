import { scanMarkdownStructure } from "../markdown/structureScanner.ts";

export type RepeatInterval = {
  amount: number;
  unit: "d" | "w" | "m" | "y";
};

export const REPEAT_TAG_REGEX = /@repeat\(([^)]+)\)/i;
export const DONE_TAG_REGEX = /@done\((\d{4}-\d{2}-\d{2})\)/i;

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(dateStr: string): Date | undefined {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  return new Date(year, month, day);
}

export function parseRepeatInterval(repeatStr: string): RepeatInterval | undefined {
  if (!repeatStr) return undefined;
  const normalized = repeatStr.trim().toLowerCase();

  if (normalized === "daily") return { amount: 1, unit: "d" };
  if (normalized === "weekly") return { amount: 1, unit: "w" };
  if (normalized === "monthly") return { amount: 1, unit: "m" };
  if (normalized === "yearly") return { amount: 1, unit: "y" };

  const match = normalized.match(/^(\d+)\s*(d(?:ays?)?|w(?:eeks?)?|m(?:onths?)?|y(?:ears?)?)?$/);
  if (!match) return undefined;

  const amount = parseInt(match[1], 10);
  if (isNaN(amount) || amount <= 0) return undefined;

  const unitPrefix = (match[2] ?? "d")[0] as "d" | "w" | "m" | "y";
  return { amount, unit: unitPrefix };
}

export function calculateNextDueDate(doneDateStr: string, repeatStr: string): Date | undefined {
  const doneDate = parseIsoDate(doneDateStr);
  if (!doneDate) return undefined;

  const interval = parseRepeatInterval(repeatStr);
  if (!interval) return undefined;

  const due = new Date(doneDate.getFullYear(), doneDate.getMonth(), doneDate.getDate());
  if (interval.unit === "d") {
    due.setDate(due.getDate() + interval.amount);
  } else if (interval.unit === "w") {
    due.setDate(due.getDate() + interval.amount * 7);
  } else if (interval.unit === "m") {
    due.setMonth(due.getMonth() + interval.amount);
  } else if (interval.unit === "y") {
    due.setFullYear(due.getFullYear() + interval.amount);
  }
  return due;
}

export function isRecurringTaskOverdue(doneDateStr: string, repeatStr: string, today: Date = new Date()): boolean {
  const dueDate = calculateNextDueDate(doneDateStr, repeatStr);
  if (!dueDate) return true; // If invalid, consider overdue to reset to clean state

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
  return todayStart >= dueStart;
}

export function updateTaskTextForToggle(taskText: string, nextChecked: boolean, today: Date = new Date()): string {
  const repeatMatch = taskText.match(REPEAT_TAG_REGEX);
  if (!repeatMatch) {
    return taskText;
  }

  if (nextChecked) {
    const todayStr = formatIsoDate(today);
    if (DONE_TAG_REGEX.test(taskText)) {
      return taskText.replace(DONE_TAG_REGEX, `@done(${todayStr})`);
    }
    return `${taskText.trimEnd()} @done(${todayStr})`;
  } else {
    return taskText.replace(/\s*@done\([^)]*\)/gi, "").trimEnd();
  }
}

export function evaluateRecurringTasks(markdown: string, today: Date = new Date()): {
  markdown: string;
  resetCount: number;
  changed: boolean;
} {
  let resetCount = 0;
  const structure = scanMarkdownStructure(markdown);
  const replacements: Array<{ from: number; to: number; text: string }> = [];

  for (let index = 0; index < structure.lines.length; index += 1) {
    const line = structure.lines[index];
    if (!structure.taskEligible[index] || structure.opaqueFencedRanges.some((range) => line.start >= range.from && line.start < range.to)) continue;
    // Match lines like: - [x] Water plants @repeat(3d) @done(2026-08-20)
    const taskLineMatch = line.text.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[xX](\]\s+.*)$/);
    if (!taskLineMatch) continue;
    const [, prefix, rest] = taskLineMatch;
    const repeatMatch = rest.match(REPEAT_TAG_REGEX);
    const doneMatch = rest.match(DONE_TAG_REGEX);

    if (repeatMatch && doneMatch) {
      const repeatExpr = repeatMatch[1];
      const doneDateStr = doneMatch[1];
      if (isRecurringTaskOverdue(doneDateStr, repeatExpr, today)) {
        resetCount += 1;
        // Clean @done tag and switch checkbox to empty space
        const cleanedRest = rest.replace(/\s*@done\([^)]*\)/gi, "");
        replacements.push({ from: line.start, to: line.contentEnd, text: `${prefix} ${cleanedRest}` });
      }
    }
  }

  let updatedMarkdown = markdown;
  for (const replacement of replacements.reverse()) {
    updatedMarkdown = updatedMarkdown.slice(0, replacement.from) + replacement.text + updatedMarkdown.slice(replacement.to);
  }

  return {
    markdown: updatedMarkdown,
    resetCount,
    changed: resetCount > 0,
  };
}
