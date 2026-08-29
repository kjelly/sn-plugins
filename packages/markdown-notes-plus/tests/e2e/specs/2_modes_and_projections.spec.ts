import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Modes and Projections", () => {
  test("Mode navigation correctly switches active panes", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const content = "# Main Heading\n\nSome text content.\n\n## Sub Heading\n\n- [ ] Task item\n";
    await host.goto(content, "note-modes-1", false);

    // Default mode is Writing
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.sourcePane).toHaveCount(0);
    await expect(editor.mindmapPane).toHaveCount(0);

    // Switch to Split mode (Writing + Mindmap)
    await editor.switchMode("Split");
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.mindmapPane).toBeVisible();
    await expect(editor.sourcePane).toHaveCount(0);

    // Switch to Source mode
    await editor.switchMode("Source");
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.writingPane).toBeHidden();
    await expect(editor.mindmapPane).toHaveCount(0);

    // Switch to Mindmap mode
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapPane).toBeVisible();
    await expect(editor.writingPane).toBeHidden();
    await expect(editor.sourcePane).toHaveCount(0);
  });

  test("Source mode opens Search / Replace panel", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Document with searchable words\n", "note-search-1", false);
    await editor.switchMode("Source");

    await expect(editor.sourceSearchPanel).toHaveCount(0);
    await editor.sourceSearchButton.click();
    await expect(editor.sourceSearchPanel).toBeVisible();
  });

  test("Outline heading click jumps to Source mode and highlights section", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# First Section\n\nContent 1\n\n## Second Section\n\nContent 2\n";
    await host.goto(doc, "note-outline-jump", false);

    // In Writing mode, outline shows 2 headings
    await expect(editor.outlineHeadings).toHaveCount(2);
    await expect(editor.outlineHeadings.nth(0)).toHaveText("First Section");
    await expect(editor.outlineHeadings.nth(1)).toHaveText("Second Section");

    // Click Second Section
    await editor.outlineHeadings.nth(1).click();

    // Editor switches to Source mode and updates Current Section in toolbar
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.currentSection).toContainText("Second Section");
  });

  test("Clicking anywhere in editing area focuses the editor", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Focus Test\n\nSome text.\n", "note-focus", false);

    // In Writing mode, click writing pane container
    await editor.writingPane.locator(".milkdown-writing").click({ position: { x: 50, y: 200 } });
    await expect(editor.writingEditor).toBeFocused();

    // Switch to Source mode, click source pane container
    await editor.switchMode("Source");
    await editor.sourcePane.locator(".cm-source").click({ position: { x: 50, y: 200 } });
    await expect(editor.sourceEditor).toBeFocused();
  });

  test("Switching from Source back to Writing preserves full editability and toolbar buttons", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Dynamic Note\n\nInitial paragraph.\n", "note-mode-toggle", false);

    // Initial state: Writing mode is active and editable
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
    await expect(editor.writingH1Button).toBeEnabled();

    // Switch to Source mode
    await editor.switchMode("Source");
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.writingPane).toBeHidden();

    // Edit in Source mode
    await editor.sourceEditor.click();
    await page.keyboard.type("\n\nExtra source text");

    // Switch back to Writing mode
    await editor.switchMode("Writing");
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.sourcePane).toHaveCount(0);

    // Verify Writing mode is immediately fully editable
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");
    await expect(editor.writingH1Button).toBeEnabled();
    await expect(editor.writingTaskButton).toBeEnabled();

    // Type in Writing mode and verify toolbar action works
    await editor.writingEditor.locator("p").first().click();
    await editor.writingTaskButton.click();
    await expect(editor.writingEditor.locator('li[data-item-type="task"]')).toBeVisible();
  });
});
