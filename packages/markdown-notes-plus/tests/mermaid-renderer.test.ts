import {
  allowedMermaidDiagramLabel,
  isMermaidLanguage,
  MAX_MERMAID_SOURCE_LENGTH,
  MermaidRenderError,
  validateMermaidSource,
} from "../src/editor/MermaidRenderer.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  readTextFile(path: string | URL): Promise<string>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrowsCode(source: string, code: MermaidRenderError["code"]): void {
  try {
    validateMermaidSource(source);
  } catch (error) {
    assert(error instanceof MermaidRenderError, "validation must use MermaidRenderError");
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected Mermaid validation to reject ${code}`);
}

Deno.test("Mermaid preview recognizes only the fenced mermaid language", () => {
  assert(isMermaidLanguage("mermaid"), "lowercase language must be recognized");
  assert(isMermaidLanguage(" Mermaid "), "language matching must be case-insensitive and trimmed");
  assert(isMermaidLanguage("MERMAID"), "uppercase language must be recognized");
  assert(!isMermaidLanguage("mermaid-js"), "lookalike languages must not opt in");
  assert(!isMermaidLanguage(undefined), "missing language must remain a code block");
});

Deno.test("Mermaid preview rejects empty, oversized, and diagram-configured sources before loading Mermaid", () => {
  assertThrowsCode("   \n", "empty");
  assertThrowsCode(`flowchart LR\n${"A".repeat(MAX_MERMAID_SOURCE_LENGTH)}`, "too-large");
  assertThrowsCode("%%{init: { 'theme': 'forest' }}%%\nflowchart LR\nA-->B", "config");
  assertThrowsCode("---\nconfig:\n  theme: forest\n---\nflowchart LR\nA-->B", "config");
  assertThrowsCode("flowchart LR\nA-->B\nclick A href \"https://example.test\"", "interaction");
  assertThrowsCode("sequenceDiagram\nlinks A: {\"Docs\": \"https://example.test\"}", "interaction");
  assertThrowsCode("flowchart LR\nA[\"<b>HTML</b>\"]", "html-label");
  assertThrowsCode('flowchart LR\nA@{ icon: "logos:github" }', "icon");
  assertThrowsCode('flowchart LR\nA@{\n  icon: "logos:github"\n}', "icon");
  validateMermaidSource("flowchart LR\nA-->B");
});

Deno.test("Mermaid preview has a fixed diagram allowlist", () => {
  for (const type of ["flowchart", "flowchart-v2", "sequence", "class", "classDiagram", "state", "stateDiagram", "er"]) {
    assert(allowedMermaidDiagramLabel(type), `${type} must be allowed`);
  }
  for (const type of ["architecture", "block", "gitGraph", "journey", "mindmap", "pie", "requirement", "sankey", "timeline", "xychart"]) {
    assert(!allowedMermaidDiagramLabel(type), `${type} must be rejected`);
  }
});

Deno.test("Mermaid dependency is pinned to the reviewed release", async () => {
  const packageJson = JSON.parse(await Deno.readTextFile(new URL("../package.json", import.meta.url)));
  assert(packageJson.dependencies?.mermaid === "11.17.2", "Mermaid must remain pinned exactly to 11.17.2");
});
