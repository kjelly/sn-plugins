import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Writing Tools & Lossless Guard", () => {
  test("Writing toolbar actions insert formatted content", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Starting Heading\n\nInitial paragraph.\n", "note-writing-tools", false);

    // Wait for Writing editor to initialize
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.writingEditor.locator("h1")).toHaveText("Starting Heading");

    // Click into paragraph
    await editor.writingEditor.locator("p").click();

    // Verify toolbar buttons are enabled
    await expect(editor.writingH1Button).toBeEnabled();
    await expect(editor.writingTableButton).toBeEnabled();
    await expect(editor.writingDividerButton).toBeEnabled();

    // Click Table button to insert a table
    await editor.writingTableButton.click();

    // Wait for Table to be rendered in Writing editor DOM
    await expect(editor.writingEditor.locator("table")).toBeVisible();

    // Switch to Source mode to inspect generated markdown table. The table
    // command may already have triggered a safe Source fallback.
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("|");
  });

  test("Writing stays editable across consecutive canonical commits and saves both edits", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Consecutive Writing edits\n\nInitial paragraph.\n", "note-writing-consecutive-edits", false);
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");

    const firstSave = host.waitForNextSave();
    await editor.writingEditor.locator("p").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" first");
    await expect(editor.writingEditor.locator("p")).toContainText("Initial paragraph. first");
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
    await firstSave;
    expect(await host.getLatestSavedText()).toContain("Initial paragraph. first");

    const secondSave = host.waitForNextSave();
    await editor.writingEditor.locator("p").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" second");
    await expect(editor.writingEditor.locator("p")).toContainText("Initial paragraph. first second");
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
    await secondSave;
    expect(await host.getLatestSavedText()).toContain("Initial paragraph. first second");

    const savedTexts = (await host.getSaves()).map((save) => save.items[0]?.content?.text);
    expect(savedTexts.some((text) => text?.includes("Initial paragraph. first"))).toBe(true);
    expect(savedTexts.some((text) => text?.includes("Initial paragraph. first second"))).toBe(true);
  });

  test("Writing mode keeps raw HTML Source-only and preserves the source", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // Raw HTML block is not lexically safe for Milkdown lossless round-trip
    const rawHtmlMarkdown = "# Note with Raw HTML\n\n<div class=\"custom-tag\">Custom HTML Content</div>\n";
    await host.goto(rawHtmlMarkdown, "note-unsafe-html", false);

    // Unsupported syntax is admitted directly to Source mode, not a readonly
    // Writing projection.
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.writingPane).toBeHidden();
    await expect(editor.sourceEditor).toContainText("<div class=\"custom-tag\">Custom HTML Content</div>");

    // Can edit in Source mode
    await editor.typeInSource("\n\nAppended source line.");
    const updatedSource = await editor.getSourceText();
    expect(updatedSource).toContain("Custom HTML Content");
    expect(updatedSource).toContain("Appended source line.");

    await editor.switchMode("Writing");
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.writingPane).toBeHidden();
  });

  test("Slash commands: typing /task and pressing Enter converts block to task item", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Slash Test\n\nExisting paragraph\n", "note-slash-command", false);

    // Wait for Writing editor to initialize
    await expect(editor.status).toHaveText("Ready");

    // Click into the writing editor and move to end
    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");

    // Type /task to trigger the slash menu
    await page.keyboard.type("/task");

    const slashMenu = editor.frame.locator(".slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu.locator(".slash-command.selected")).toContainText("/task");

    // Press Enter to apply the slash command
    await page.keyboard.press("Enter");

    // Task item is created with checkbox
    const taskItem = editor.writingEditor.locator('li[data-item-type="task"]');
    await expect(taskItem).toBeVisible();
    const checkbox = taskItem.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    // Type task description
    await page.keyboard.type("Buy groceries");

    // Switch to Source mode to verify generated markdown
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("- [ ] Buy groceries");
  });

  test("Writing mode asks before normalizing multiple trailing empty lines", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const docWithTrailingBlankLines = "# Notes with Blank Lines\n\nContent paragraph.\n\n\n\n\n\n";
    await host.goto(docWithTrailingBlankLines, "note-trailing-blank-lines", false);

    const dialog = editor.frame.getByRole("dialog", { name: "Writing normalization required" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "留在 Source" }).click();
    await expect(editor.sourcePane).toBeVisible();
  });

  test("Writing mode admits a codec-proven Markdown hard break", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const markdown = "# Hard break\n\nFirst line  \nSecond line\n";

    await host.goto(markdown, "note-hard-break", false);
    const dialog = editor.frame.getByRole("dialog", { name: "Writing normalization required" });
    const needsNormalization = await dialog.isVisible();
    if (needsNormalization) {
      await dialog.getByRole("button", { name: "套用並進入 Writing" }).click();
      await expect(dialog).toBeHidden();
      // Applying the codec's canonical hard-break spelling is itself a save.
      // Wait for it so the assertion below observes the user's edit instead.
      await expect.poll(async () => (await host.getSaves()).length).toBeGreaterThan(0);
      await host.clearSaves();
    }

    await expect(editor.writingPane).toBeVisible();
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
    await expect(editor.writingEditor).toContainText("First line");
    await expect(editor.writingEditor).toContainText("Second line");

    const savePromise = host.waitForNextSave();
    await editor.writingEditor.locator("p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" updated");
    await expect(editor.writingEditor.locator("p").last()).toContainText("updated");
    await savePromise;
    expect(await host.getLatestSavedText()).toContain("updated");
  });
});
