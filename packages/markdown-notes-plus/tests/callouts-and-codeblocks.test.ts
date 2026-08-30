function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  extractCalloutType,
  CALLOUT_META,
  CALLOUT_REGEX,
  type CalloutType,
} from "../src/editor/WritingCallouts.ts";

Deno.test("WritingCallouts - CALLOUT_REGEX matches all standard callout tags case-insensitively", () => {
  const noteMatch = "[!NOTE]".match(CALLOUT_REGEX);
  assertEquals(noteMatch?.[1].toLowerCase(), "note");

  const tipMatch = "[!Tip]".match(CALLOUT_REGEX);
  assertEquals(tipMatch?.[1].toLowerCase(), "tip");

  const importantMatch = "[!IMPORTANT]".match(CALLOUT_REGEX);
  assertEquals(importantMatch?.[1].toLowerCase(), "important");

  const warningMatch = "[!warning]".match(CALLOUT_REGEX);
  assertEquals(warningMatch?.[1].toLowerCase(), "warning");

  const cautionMatch = "[!CAUTION]".match(CALLOUT_REGEX);
  assertEquals(cautionMatch?.[1].toLowerCase(), "caution");

  const invalidMatch = "[!UNKNOWN]".match(CALLOUT_REGEX);
  assertEquals(invalidMatch, null);
});

Deno.test("WritingCallouts - CALLOUT_META defines properties for each callout type", () => {
  const types: CalloutType[] = ["note", "tip", "important", "warning", "caution"];
  for (const t of types) {
    const meta = CALLOUT_META[t];
    assertEquals(meta.type, t);
    assertEquals(typeof meta.title, "string");
    assertEquals(typeof meta.icon, "string");
    assertEquals(typeof meta.color, "string");
  }
});

import type { Node as ProseNode } from "@milkdown/prose/model";

Deno.test("WritingCallouts - extractCalloutType inspects blockquote nodes accurately", () => {
  const fakeBlockquoteNode = (text: string) => ({
    type: { name: "blockquote" },
    childCount: 1,
    firstChild: {
      type: { name: "paragraph" },
      textContent: text,
    },
  });

  assertEquals(extractCalloutType(fakeBlockquoteNode("[!NOTE] This is a note") as unknown as ProseNode), "note");
  assertEquals(extractCalloutType(fakeBlockquoteNode("[!TIP] A helpful tip") as unknown as ProseNode), "tip");
  assertEquals(extractCalloutType(fakeBlockquoteNode("[!IMPORTANT] Must read") as unknown as ProseNode), "important");
  assertEquals(extractCalloutType(fakeBlockquoteNode("[!WARNING] Be careful") as unknown as ProseNode), "warning");
  assertEquals(extractCalloutType(fakeBlockquoteNode("[!CAUTION] Critical danger") as unknown as ProseNode), "caution");
  assertEquals(extractCalloutType(fakeBlockquoteNode("Regular quote without tag") as unknown as ProseNode), undefined);

  const nonBlockquote = {
    type: { name: "paragraph" },
    childCount: 1,
    firstChild: { textContent: "[!NOTE] in paragraph" },
  };
  assertEquals(extractCalloutType(nonBlockquote as unknown as ProseNode), undefined);
});
