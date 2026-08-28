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
});
