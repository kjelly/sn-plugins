import { expect, test } from "@playwright/test";
import { generateMixedFixture } from "../../performance/generatePerfMarkdown.ts";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test("large Writing note edits one bounded section at a time without changing the rest", async ({ page }) => {
  const source = generateMixedFixture(180 * 1024, "writing-windows-e2e").markdown;
  const host = new MockHost(page, 120_000);
  const editor = new EditorPage(page);
  await host.goto(source, "writing-windows-note", false);

  const sectionSelect = editor.writingPane.getByRole("combobox", { name: "Editing section" });
  await expect(sectionSelect).toBeVisible();
  const windowCount = await sectionSelect.locator("option").count();
  expect(windowCount).toBeGreaterThan(2);
  await expect(editor.writingEditor).toBeEditable();
  expect(await editor.writingEditor.locator("h2").count()).toBeLessThan(250);

  const firstHeading = editor.writingEditor.locator("h2").first();
  await firstHeading.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  const afterFirst = source.replace("## Section 0\n", "## Section 0 edited\n");
  await expect.poll(() => host.getLatestSavedText(), { timeout: 15_000 }).toBe(afterFirst);

  await sectionSelect.selectOption("1");
  const nextHeading = editor.writingEditor.locator("h2").first();
  await expect(nextHeading).toBeVisible();
  const originalHeading = await nextHeading.textContent();
  expect(originalHeading).toMatch(/^Section \d+$/);
  await nextHeading.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" second-edit");
  const afterSecond = afterFirst.replace(`## ${originalHeading}\n`, `## ${originalHeading} second-edit\n`);
  await expect.poll(() => host.getLatestSavedText(), { timeout: 15_000 }).toBe(afterSecond);
  await expect(editor.writingEditor).toBeEditable();

  await expect(editor.outlinePanel.locator(".outline-row")).toHaveCount(200);
  await editor.outlinePanel.getByRole("searchbox", { name: "Find outline heading" }).fill("Section 1000");
  const distantHeading = editor.outlinePanel.locator(".outline-row").filter({ hasText: "Section 1000" });
  await expect(distantHeading).toHaveCount(1);
  await distantHeading.locator(".outline-heading-btn").click();
  await expect(editor.writingEditor.locator("h2").filter({ hasText: /^Section 1000$/ })).toBeVisible();
  await expect(editor.writingEditor).toBeEditable();

  await page.keyboard.press("Control+z");
  await expect.poll(() => host.getLatestSavedText(), { timeout: 15_000 }).toBe(afterFirst);
  await page.keyboard.press("Control+y");
  await expect.poll(() => host.getLatestSavedText(), { timeout: 15_000 }).toBe(afterSecond);

  await page.keyboard.press("Control+a");
  await expect(editor.sourcePane).toBeVisible();
  await expect(editor.sourceEditor).toBeFocused();
  await page.keyboard.insertText("# Whole-note replacement\n");
  await expect.poll(() => host.getLatestSavedText(), { timeout: 15_000 }).toBe("# Whole-note replacement\n");
});

test("whole-note search from a section opens Source search", async ({ page }) => {
  const source = generateMixedFixture(130 * 1024, "writing-window-search").markdown;
  const host = new MockHost(page, 120_000);
  const editor = new EditorPage(page);
  await host.goto(source, "writing-window-search-note", false);
  await expect(editor.writingPane.getByRole("combobox", { name: "Editing section" })).toBeVisible();
  await editor.writingEditor.click();
  await page.keyboard.press("Control+f");
  await expect(editor.sourcePane).toBeVisible();
  await expect(editor.sourceSearchPanel).toBeVisible();
});

test("unsupported syntax outside the first window skips Milkdown creation", async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { __MARKDOWN_NOTES_PERF_ENABLED__?: boolean }).__MARKDOWN_NOTES_PERF_ENABLED__ = true;
  });
  const source = `${generateMixedFixture(180 * 1024, "writing-window-unsupported").markdown}\n<div>Source-only HTML</div>\n`;
  const host = new MockHost(page, 120_000);
  const editor = new EditorPage(page);
  await host.goto(source, "writing-window-unsupported-note", false);

  await expect(editor.sourcePane).toBeVisible();
  await expect(editor.writingEditor).toHaveCount(0);
  expect(await host.getLatestSavedText()).toBeUndefined();
  const frame = page.frames().find((candidate) => candidate.url().includes("/index.html"));
  expect(frame).toBeDefined();
  const marks = await frame!.evaluate(() => {
    const trace = (globalThis as typeof globalThis & {
      __MARKDOWN_NOTES_PERF_TRACE__?: { marks: Array<{ name: string }> };
    }).__MARKDOWN_NOTES_PERF_TRACE__;
    return trace?.marks.map((mark) => mark.name) ?? [];
  });
  expect(marks).toContain("writing_preflight_end");
  expect(marks).not.toContain("milkdown_create_start");
});
