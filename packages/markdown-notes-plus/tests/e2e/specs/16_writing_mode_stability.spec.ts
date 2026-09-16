import { expect, test, type Locator, type Page } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

const LISTENER_SETTLE_MS = 350;

async function placeCaretInside(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, globalThis.NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!text?.textContent) throw new Error("Expected editable text");
    const selection = globalThis.getSelection();
    const range = document.createRange();
    range.setStart(text, Math.max(1, Math.floor(text.textContent.length / 2)));
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function expectWritingStable(page: Page, editor: EditorPage): Promise<void> {
  await page.waitForTimeout(LISTENER_SETTLE_MS);
  await expect(editor.writingPane).toBeVisible();
  await expect(editor.sourcePane).toBeHidden();
  await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
  await expect(editor.status).not.toContainText("Source fallback");
}

test.describe("Writing mode stability contract", () => {
  test("Enter stays in Writing across supported block types", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const cases: Array<{ name: string; markdown: string; target: () => Locator }> = [
      { name: "paragraph", markdown: "ParagraphAlpha\n", target: () => editor.writingEditor.locator("p") },
      { name: "heading", markdown: "# HeadingAlpha\n", target: () => editor.writingEditor.locator("h1") },
      { name: "bullet", markdown: "- BulletAlpha\n", target: () => editor.writingEditor.locator("li p") },
      { name: "task", markdown: "- [ ] TaskAlpha\n", target: () => editor.writingEditor.locator(".task-content") },
      { name: "quote", markdown: "> QuoteAlpha\n", target: () => editor.writingEditor.locator("blockquote p") },
      { name: "code", markdown: "```text\nCodeAlpha\n```\n", target: () => editor.writingEditor.locator(".code-block-content") },
    ];

    await host.goto(cases[0].markdown, `writing-stability-${cases[0].name}`, false);
    for (const [index, scenario] of cases.entries()) {
      if (index > 0) await host.setNote(scenario.markdown, `writing-stability-${scenario.name}`, false);
      await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
      const target = scenario.target();
      await expect(target).toBeVisible();
      await placeCaretInside(target);
      await page.keyboard.press("Enter");
      await expectWritingStable(page, editor);
      await page.keyboard.type(`continued-${scenario.name}`);
      await expectWritingStable(page, editor);
      await expect.poll(() => host.getLatestSavedText()).toContain(`continued-${scenario.name}`);
    }
  });

  test("ordinary editing keys and history never activate Source fallback", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("AlphaBeta\n\nSecond paragraph.\n", "writing-stability-keys", false);
    const firstParagraph = editor.writingEditor.locator("p").first();
    await placeCaretInside(firstParagraph);

    await page.keyboard.type(" inserted ");
    await expectWritingStable(page, editor);
    await page.keyboard.press("Enter");
    await expectWritingStable(page, editor);
    await page.keyboard.type("new paragraph");
    await expectWritingStable(page, editor);
    await page.keyboard.press("Backspace");
    await expectWritingStable(page, editor);
    await page.keyboard.press("ControlOrMeta+z");
    await expectWritingStable(page, editor);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectWritingStable(page, editor);

    await expect.poll(() => host.getLatestSavedText()).toContain("inserted");
  });

  test("supported toolbar transformations stay in Writing", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const cases: Array<{
      name: string;
      run: () => Promise<void>;
      result: () => Locator;
    }> = [
      { name: "heading", run: () => editor.writingH1Button.click(), result: () => editor.writingEditor.locator("h1") },
      { name: "heading2", run: () => editor.writingH2Button.click(), result: () => editor.writingEditor.locator("h2") },
      { name: "bullet", run: () => editor.writingBulletButton.click(), result: () => editor.writingEditor.locator("li p") },
      { name: "task", run: () => editor.writingTaskButton.click(), result: () => editor.writingEditor.locator(".task-content") },
      { name: "quote", run: () => editor.writingQuoteButton.click(), result: () => editor.writingEditor.locator("blockquote p") },
      { name: "code", run: () => editor.writingCodeButton.click(), result: () => editor.writingEditor.locator(".code-block-content") },
      { name: "table", run: () => editor.writingTableButton.click(), result: () => editor.writingEditor.locator("table") },
      { name: "divider", run: () => editor.writingDividerButton.click(), result: () => editor.writingEditor.locator("hr") },
    ];

    await host.goto("Toolbar target\n", `writing-toolbar-${cases[0].name}`, false);
    for (const [index, scenario] of cases.entries()) {
      if (index > 0) await host.setNote("Toolbar target\n", `writing-toolbar-${scenario.name}`, false);
      await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
      await editor.writingEditor.getByText("Toolbar target", { exact: true }).click();
      await scenario.run();
      await expect(scenario.result()).toBeVisible();
      await expectWritingStable(page, editor);
    }
  });

  test("unsupported external Markdown remains Source-only without weakening the guard", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const unsupported = [
      "# Note with Raw HTML\n\n<div class=\"custom-tag\">Custom HTML Content</div>\n",
      "# Reference link\n\n[label][reference]\n\n[reference]: https://example.test\n",
      "# Unknown extension\n\n:::unknown-extension\ncontent\n:::\n",
    ];

    await host.goto(unsupported[0], "note-unsafe-html", false);
    for (const [index, markdown] of unsupported.entries()) {
      if (index > 0) await host.setNote(markdown, `writing-stability-unsupported-${index}`, false);
      await expect(editor.sourcePane).toBeVisible();
      await expect(editor.writingPane).toBeHidden();
      expect(await editor.getSourceText()).toBe(markdown);
    }
  });
});
