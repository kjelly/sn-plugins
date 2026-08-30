function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  createEmptyLibrary,
  expandTemplateVariables,
  extractNoteTitle,
  resolveAllTemplates,
  resolveAllSnippets,
  validateLibraryQuota,
  exportLibraryToJson,
  importLibraryFromJson,
  type InsertLibrary,
  type TemplateDefinition,
  type SnippetDefinition,
} from "../src/templates/TemplateEngine.ts";
import { BUILTIN_TEMPLATES, BUILTIN_SNIPPETS } from "../src/templates/BuiltinTemplates.ts";

Deno.test("TemplateEngine - built-ins are defined correctly", () => {
  assertEquals(BUILTIN_TEMPLATES.length, 5);
  const templateIds = BUILTIN_TEMPLATES.map((t) => t.id);
  assertEquals(templateIds, [
    "builtin-project",
    "builtin-knowledge",
    "builtin-research",
    "builtin-troubleshooting",
    "builtin-weekly-plan",
  ]);

  assertEquals(BUILTIN_SNIPPETS.length, 3);
  const snippetTriggers = BUILTIN_SNIPPETS.map((s) => s.trigger);
  assertEquals(snippetTriggers, ["decision", "reference", "command"]);
});

Deno.test("TemplateEngine - expandTemplateVariables replaces date, time, title, selection and cursor", () => {
  const fixedDate = new Date(2026, 7, 30, 14, 25); // 2026-08-30 14:25
  const template = `# {{noteTitle}}
Date: {{date}} Time: {{time}} Full: {{datetime}}
Selection: "{{selection}}"
Start writing here: {{cursor}}End.`;

  const result = expandTemplateVariables(template, {
    date: fixedDate,
    noteTitle: "My Awesome Project",
    selection: "Highlight this quote",
  });

  const expectedText = `# My Awesome Project
Date: 2026-08-30 Time: 14:25 Full: 2026-08-30 14:25
Selection: "Highlight this quote"
Start writing here: End.`;

  assertEquals(result.text, expectedText);
  assertEquals(result.cursorOffset, expectedText.indexOf("Start writing here: ") + "Start writing here: ".length);
});

Deno.test("TemplateEngine - extractNoteTitle extracts first H1 or defaults to Untitled", () => {
  assertEquals(extractNoteTitle("# Project Alpha\nSome body text"), "Project Alpha");
  assertEquals(extractNoteTitle("## Subsection\n# Later Title"), "Later Title");
  assertEquals(extractNoteTitle("No headings here\nJust text"), "Untitled");
});

Deno.test("TemplateEngine - resolveAllTemplates and resolveAllSnippets respect hiddenBuiltins", () => {
  const lib: InsertLibrary = {
    schemaVersion: 1,
    templates: [
      {
        id: "custom-1",
        name: "Custom Template 1",
        content: "Custom content",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    snippets: [],
    hiddenBuiltins: ["builtin-project", "builtin-snippet-decision"],
  };

  const allT = resolveAllTemplates(lib);
  assertEquals(allT.length, 5); // 4 builtins + 1 custom
  assertEquals(allT.some((t) => t.id === "builtin-project"), false);
  assertEquals(allT.some((t) => t.id === "custom-1"), true);

  const allS = resolveAllSnippets(lib);
  assertEquals(allS.length, 2); // 2 builtins (decision hidden)
  assertEquals(allS.some((s) => s.trigger === "decision"), false);
});

Deno.test("TemplateEngine - validateLibraryQuota flags oversized templates or library", () => {
  const lib = createEmptyLibrary();
  assertEquals(validateLibraryQuota(lib).valid, true);

  // Template > 64 KB
  const hugeContent = "x".repeat(65 * 1024);
  lib.templates.push({
    id: "huge",
    name: "Huge Template",
    content: hugeContent,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });

  const check = validateLibraryQuota(lib);
  assertEquals(check.valid, false);
  assertEquals(check.message?.includes("exceeds 64 KB limit"), true);
});

Deno.test("TemplateEngine - export and import JSON with conflict policies", () => {
  const customT1: TemplateDefinition = {
    id: "custom-t1",
    name: "Custom T1",
    content: "T1 content",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  const customS1: SnippetDefinition = {
    id: "custom-s1",
    name: "Custom S1",
    trigger: "s1",
    content: "S1 content",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  const currentLib: InsertLibrary = {
    schemaVersion: 1,
    templates: [customT1],
    snippets: [customS1],
    hiddenBuiltins: ["builtin-project"],
  };

  const exported = exportLibraryToJson(currentLib);
  assertEquals(exported.includes("custom-t1"), true);
  assertEquals(exported.includes("custom-s1"), true);
  const incomingJson = JSON.stringify({
    schemaVersion: 1,
    templates: [
      customT1, // duplicate id
      {
        id: "incoming-t2",
        name: "Incoming T2",
        content: "T2 content",
        createdAt: "2026-01-02",
        updatedAt: "2026-01-02",
      },
    ],
    snippets: [
      {
        id: "incoming-s2",
        name: "Incoming S2",
        trigger: "s2",
        content: "S2 content",
        createdAt: "2026-01-02",
        updatedAt: "2026-01-02",
      },
    ],
  });

  // Policy 1: keep-existing
  const resKeep = importLibraryFromJson(currentLib, incomingJson, "keep-existing");
  assertEquals(resKeep.addedTemplates, 1);
  assertEquals(resKeep.addedSnippets, 1);
  assertEquals(resKeep.library.templates.length, 2);

  // Policy 2: replace-all
  const resReplace = importLibraryFromJson(currentLib, incomingJson, "replace-all");
  assertEquals(resReplace.addedTemplates, 2);
  assertEquals(resReplace.addedSnippets, 1);
  assertEquals(resReplace.library.templates.length, 2);

  // Policy 3: import-copy
  const resCopy = importLibraryFromJson(currentLib, incomingJson, "import-copy");
  assertEquals(resCopy.addedTemplates, 2); // custom-t1 renamed to copy + incoming-t2
  assertEquals(resCopy.library.templates.length, 3);
  assertEquals(resCopy.library.templates[1].name, "Custom T1 (Copy)");
});
