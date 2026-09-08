function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { isUrl, processSmartPaste } from "../src/paste/SmartPaste.ts";

Deno.test("SmartPaste - isUrl accurately identifies http/https URLs", () => {
  assertEquals(isUrl("https://standardnotes.com"), true);
  assertEquals(isUrl("http://localhost:3000/docs"), true);
  assertEquals(isUrl("https://github.com/standardnotes/app/pull/123"), true);
  assertEquals(isUrl("not a url"), false);
  assertEquals(isUrl("ftp://file.com"), false);
  assertEquals(isUrl("javascript:alert(1)"), false);
});

Deno.test("SmartPaste - wraps selected text as markdown link when pasting URL", () => {
  const result = processSmartPaste(
    { text: "https://example.com" },
    "My Documentation Link",
  );
  assertEquals(result.type, "link");
  assertEquals(result.content, "[My Documentation Link](https://example.com)");
});

Deno.test("SmartPaste - falls back to plain text when no selection or non-URL", () => {
  const result1 = processSmartPaste({ text: "Just plain text" });
  assertEquals(result1.type, "text");
  assertEquals(result1.content, "Just plain text");

  const result2 = processSmartPaste({ text: "Just plain text" }, "Selected Text");
  assertEquals(result2.type, "text");
  assertEquals(result2.content, "Just plain text");
});

Deno.test("SmartPaste - normalizes a bare URL before Writing parses it", () => {
  const result = processSmartPaste({
    text: "https://chatgpt.com/g/g-p-6a6081c56d8c81919f379d1c979634e8-hufu/c/6a9fa1b0-dbe4-83e8-874c-650a658b5c8e",
  });
  assertEquals(result.type, "markdown");
  assertEquals(
    result.content,
    "[https://chatgpt.com/g/g-p-6a6081c56d8c81919f379d1c979634e8-hufu/c/6a9fa1b0-dbe4-83e8-874c-650a658b5c8e](https://chatgpt.com/g/g-p-6a6081c56d8c81919f379d1c979634e8-hufu/c/6a9fa1b0-dbe4-83e8-874c-650a658b5c8e)",
  );
});
