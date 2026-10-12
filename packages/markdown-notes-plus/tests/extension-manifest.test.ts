import { test } from "bun:test";

function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

test("extension manifest has valid Standard Notes editor descriptor", async () => {
  const content = await Bun.file("public/ext.json").text();
  const manifest = JSON.parse(content);

  assertEquals(manifest.identifier, "org.standardnotes.markdown-notes-plus");
  assertEquals(manifest.name, "Markdown Notes+");
  assertEquals(manifest.content_type, "SN|Component");
  assertEquals(manifest.area, "editor-editor");
  assertEquals(manifest.file_type, "md");
  assertEquals(manifest.note_type, "markdown");
  assertEquals(typeof manifest.url, "string");
  assertEquals(manifest.interchangeable, true);
});
