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

    // Switch to Source mode to inspect generated markdown table
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("|");
  });

  test("Writing mode enforces read-only for lexically unsafe or raw HTML Markdown", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // Raw HTML block is not lexically safe for Milkdown lossless round-trip
    const rawHtmlMarkdown = "# Note with Raw HTML\n\n<div class=\"custom-tag\">Custom HTML Content</div>\n";
    await host.goto(rawHtmlMarkdown, "note-unsafe-html", false);

    // Status shows Writing read-only warning
    await expect(editor.status).toContainText("Writing read-only");

    // Toolbar buttons are disabled in Writing mode to prevent lossy serialization
    await expect(editor.writingH1Button).toBeDisabled();
    await expect(editor.writingTableButton).toBeDisabled();

    // Switch to Source mode -> Source mode is fully editable
    await editor.switchMode("Source");
    await expect(editor.status).toHaveText("Ready");

    // Can edit in Source mode
    await editor.typeInSource("\n\nAppended source line.");
    const updatedSource = await editor.getSourceText();
    expect(updatedSource).toContain("Custom HTML Content");
    expect(updatedSource).toContain("Appended source line.");
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
});
