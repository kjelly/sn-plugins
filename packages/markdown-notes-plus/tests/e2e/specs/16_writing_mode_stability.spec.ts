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

async function placeCaretAt(locator: Locator, edge: "start" | "end"): Promise<void> {
  await locator.evaluate((element, requestedEdge) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(requestedEdge === "start");
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, edge);
}

async function selectContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function selectAcross(start: Locator, end: Locator): Promise<void> {
  const startHandle = await start.elementHandle();
  const endHandle = await end.elementHandle();
  if (!startHandle || !endHandle) throw new Error("Expected selection endpoints");
  await startHandle.evaluate((startElement, endElement) => {
    const firstText = startElement.firstChild;
    const lastText = endElement.lastChild;
    if (!firstText || !lastText) throw new Error("Expected text selection endpoints");
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(lastText, lastText.textContent?.length ?? 0);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, endHandle);
}

async function pasteInto(locator: Locator, text: string, html = ""): Promise<void> {
  await locator.evaluate((element, payload) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", payload.text);
    if (payload.html) clipboardData.setData("text/html", payload.html);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, { text, html });
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

  test("inline marks and link create, update, and remove stay in Writing", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const marks = [
      { name: "bold", shortcut: "ControlOrMeta+b", selector: "strong", markdown: "**bold text**" },
      { name: "italic", shortcut: "ControlOrMeta+i", selector: "em", markdown: "*italic text*" },
      { name: "strike", shortcut: "ControlOrMeta+Shift+x", selector: "del", markdown: "~~strike text~~" },
      { name: "inline-code", shortcut: "ControlOrMeta+e", selector: "code", markdown: "`inline-code text`" },
    ];

    await host.goto("bold text\n", "writing-mark-bold", false);
    for (const [index, scenario] of marks.entries()) {
      if (index > 0) await host.setNote(`${scenario.name} text\n`, `writing-mark-${scenario.name}`, false);
      const paragraph = editor.writingEditor.locator("p").first();
      await selectContents(paragraph);
      await page.keyboard.press(scenario.shortcut);
      await expect(paragraph.locator(scenario.selector)).toBeVisible();
      await expectWritingStable(page, editor);
      await expect.poll(() => host.getLatestSavedText()).toContain(scenario.markdown);
      await placeCaretAt(paragraph, "end");
      await page.keyboard.type("!");
      await expectWritingStable(page, editor);
      await expect.poll(() => host.getLatestSavedText()).toContain("!");
    }

    await host.setNote("Link text\n", "writing-mark-link", false);
    const paragraph = editor.writingEditor.locator("p").first();
    const dialog = editor.frame.getByRole("dialog", { name: "Insert link" });
    const input = dialog.locator("#link-dialog-url");
    await selectContents(paragraph);
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("https://first.example/path");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(editor.writingEditor.locator("a")).toHaveAttribute("href", "https://first.example/path");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("[Link text](https://first.example/path)");

    await selectContents(paragraph);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toHaveValue("https://first.example/path");
    await input.fill("https://second.example/updated");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("[Link text](https://second.example/updated)");

    await selectContents(paragraph);
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(editor.writingEditor.locator("a")).toHaveCount(0);
    await placeCaretAt(paragraph, "end");
    await page.keyboard.type(" after-link");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Link text after-link");
  });

  test("plain, multiline, rich, URL, and selected-text paste stay in Writing", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", "Synthetic ClipboardEvent paste semantics are not supported consistently in Firefox.");
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Paste target\n", "writing-paste-plain", false);
    let paragraph = editor.writingEditor.locator("p").first();
    await placeCaretAt(paragraph, "end");
    await pasteInto(paragraph, " plain text");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Paste target plain text");

    await placeCaretAt(paragraph, "end");
    await pasteInto(paragraph, "\nsecond line\nthird line");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("second line");
    await expect.poll(() => host.getLatestSavedText()).toContain("third line");

    await host.setNote("Rich target\n", "writing-paste-rich", false);
    paragraph = editor.writingEditor.locator("p").first();
    await selectContents(paragraph);
    await pasteInto(paragraph, "Rich heading\nformatted", "<h2>Rich heading</h2><p><strong>formatted</strong></p>");
    await expect(editor.writingEditor.locator("h2")).toContainText("Rich heading");
    await expect(editor.writingEditor.locator("strong")).toContainText("formatted");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("## Rich heading");

    await host.setNote("URL insertion\n", "writing-paste-url", false);
    paragraph = editor.writingEditor.locator("p").first();
    await placeCaretAt(paragraph, "end");
    await pasteInto(paragraph, "https://example.test/direct");
    await expect(editor.writingEditor.locator("a")).toHaveAttribute("href", "https://example.test/direct");
    await expectWritingStable(page, editor);

    await host.setNote("Selected label\n", "writing-paste-selected-url", false);
    paragraph = editor.writingEditor.locator("p").first();
    await selectContents(paragraph);
    await pasteInto(paragraph, "https://example.test/selected");
    await expect(editor.writingEditor.locator("a")).toContainText("Selected label");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("[Selected label](https://example.test/selected)");
  });

  test("URL paste stays inline inside a task", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", "Synthetic ClipboardEvent paste semantics are not supported consistently in Firefox.");
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("- [ ] Selected task label\n", "writing-paste-task-selected-url", false);
    let taskContent = editor.writingEditor.locator(".task-content").first();
    await selectContents(taskContent);
    await pasteInto(taskContent, "https://example.test/task-selected");
    await expect(taskContent.locator("a")).toHaveAttribute("href", "https://example.test/task-selected");
    await expect(taskContent.locator("a")).toContainText("Selected task label");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("- [ ] [Selected task label](https://example.test/task-selected)");

    await host.setNote("- [ ] Task URL target\n", "writing-paste-task-cursor-url", false);
    taskContent = editor.writingEditor.locator(".task-content").first();
    await placeCaretAt(taskContent, "end");
    await pasteInto(taskContent, "https://example.test/task-cursor");
    await expect(taskContent.locator("a")).toHaveAttribute("href", "https://example.test/task-cursor");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("- [ ] Task URL target[https://example.test/task-cursor](https://example.test/task-cursor)");
  });

  test("cross-paragraph, full-selection, and mouse-drag replacement stay in Writing", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("First paragraph\n\nSecond paragraph\n\nThird paragraph\n", "writing-selection", false);
    const paragraphs = editor.writingEditor.locator("p");
    await selectAcross(paragraphs.nth(0), paragraphs.nth(1));
    await page.keyboard.type("Combined replacement");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Combined replacement");
    await expect.poll(() => host.getLatestSavedText()).not.toContain("Second paragraph");

    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Document replacement");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toBe("Document replacement\n");

    await host.setNote("Drag selection start\n\nDrag selection finish\n", "writing-selection-drag", false);
    const dragParagraphs = editor.writingEditor.locator("p");
    const startBox = await dragParagraphs.nth(0).boundingBox();
    const endBox = await dragParagraphs.nth(1).boundingBox();
    if (!startBox || !endBox) throw new Error("Expected paragraph geometry for drag selection");
    await page.mouse.move(startBox.x + 3, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width - 3, endBox.y + endBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.type("Dragged replacement");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Dragged replacement");
    await expect.poll(() => host.getLatestSavedText()).not.toContain("Drag selection finish");
  });

  test("list indentation, empty-item Enter, and start Backspace stay in Writing", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("- First item\n- Second item\n", "writing-list-keys", false);
    let items = editor.writingEditor.locator("li p");
    await placeCaretAt(items.nth(1), "end");
    await page.keyboard.press("Tab");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("  - Second item");
    await page.keyboard.press("Shift+Tab");
    await expectWritingStable(page, editor);

    items = editor.writingEditor.locator("li p");
    await placeCaretAt(items.first(), "end");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expectWritingStable(page, editor);
    await page.keyboard.type("After empty item");
    await expectWritingStable(page, editor);

    await host.setNote("- First item\n- Second item\n", "writing-list-backspace", false);
    items = editor.writingEditor.locator("li p");
    await placeCaretAt(items.nth(1), "start");
    await page.keyboard.press("Backspace");
    await expectWritingStable(page, editor);
    await page.keyboard.type("Moved ");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Moved Second item");
  });

  test("task, code, and Mermaid node views stay editable", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("- [ ] Task item\n", "writing-node-task", false);
    const checkbox = editor.writingEditor.locator('input[type="checkbox"]');
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("- [x] Task item");

    await host.setNote("```text\ncode value\n```\n", "writing-node-code", false);
    let code = editor.writingEditor.locator(".code-block-content");
    await placeCaretAt(code, "end");
    await page.keyboard.type(" updated");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("code value updated");

    await host.setNote("```mermaid\ngraph TD\n  A-->B\n```\n", "writing-node-mermaid", false);
    const previewButton = editor.writingEditor.getByRole("button", { name: "Render Mermaid preview" });
    const sourceButton = editor.writingEditor.getByRole("button", { name: "Show editable Mermaid source" });
    await previewButton.click();
    await expectWritingStable(page, editor);
    await sourceButton.click();
    code = editor.writingEditor.locator(".code-block-content");
    await placeCaretAt(code, "end");
    await page.keyboard.type("\n  B-->C");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("B-->C");
  });

  test("normalized callout node view stays editable", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto(
      "# Callout stability\n\n> [!NOTE]\n> Callout body\n\n```text\nvalue\n```\n",
      "writing-node-callout",
      false,
    );
    const normalization = editor.frame.getByRole("dialog", { name: "Writing normalization required" });
    await expect(normalization).toBeVisible();
    await normalization.getByRole("button", { name: "套用並進入 Writing" }).click();
    const callout = editor.writingEditor.locator(".callout-card p").last();
    await placeCaretAt(callout, "end");
    await page.keyboard.type(" updated");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Callout body updated");
  });

  test("Chromium IME composition and subsequent Enter stay in Writing", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "CDP IME input is a Chromium contract.");
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("輸入：\n", "writing-ime", false);
    const paragraph = editor.writingEditor.locator("p").first();
    await placeCaretAt(paragraph, "end");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "中文輸入",
      selectionStart: 4,
      selectionEnd: 4,
    });
    await cdp.send("Input.insertText", { text: "中文輸入" });
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("中文輸入");
    await page.keyboard.press("Enter");
    await page.keyboard.type("完成");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("完成");
  });

  test("clean remote replacement does not reuse stale local proof or leave Writing", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Local text\n", "writing-remote", false);
    await expectWritingStable(page, editor);

    await host.updateCurrentNote("Remote replacement\n");
    await expect(editor.writingEditor).toContainText("Remote replacement");
    await expectWritingStable(page, editor);
    await placeCaretAt(editor.writingEditor.locator("p").first(), "end");
    await page.keyboard.type(" continued");
    await expectWritingStable(page, editor);
    await expect.poll(() => host.getLatestSavedText()).toContain("Remote replacement continued");
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
