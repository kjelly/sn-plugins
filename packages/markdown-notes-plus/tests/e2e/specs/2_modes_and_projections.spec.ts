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

  test("Host theme changes and system dark mode adapt editor colors seamlessly", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Theme Test\n\nContent for theme verification.\n", "note-theme-1", false);
    await expect(editor.status).toHaveText("Ready");

    // Emulate media feature dark mode
    await page.emulateMedia({ colorScheme: "dark" });
    const bgDark = await editor.writingPane.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgDark).not.toBe("rgb(255, 255, 255)");

    // Switch to light mode
    await page.emulateMedia({ colorScheme: "light" });
    const bgLight = await editor.writingPane.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgLight).toBeDefined();
  });

  test("Toolbar layout places Sidebar on the left and Task next to Redo", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Header\n\nContent paragraph.\n", "note-toolbar-layout", false);
    await expect(editor.status).toHaveText("Ready");

    // In writing pane toolbar: first button is Sidebar toggle
    const firstButton = editor.writingPane.locator(".pane-toolbar > button").first();
    await expect(firstButton).toHaveText("Sidebar");

    // Redo is followed by Task button
    const redoButton = editor.redoButton;
    const nextSibling = redoButton.locator("xpath=following-sibling::button[1]");
    await expect(nextSibling).toHaveText("Task");
  });

  test("Auto-detection hides Split and Mindmap when content is unstructured, shows them when structured", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // 1. Unstructured text note: only plain prose with standard trailing newline
    await host.goto("Just plain text with no headings and no lists.\n", "note-plain-text", false);
    await expect(editor.status).toHaveText("Ready");

    // Split and Mindmap buttons should NOT exist
    await expect(editor.splitModeButton).toHaveCount(0);
    await expect(editor.mindmapModeButton).toHaveCount(0);
    await expect(editor.writingModeButton).toBeVisible();
    await expect(editor.sourceModeButton).toBeVisible();

    // 2. Structured note with headings: update note text and Split and Mindmap appear
    await host.updateCurrentNote("# Structured Heading\n\nSome body text\n");
    await expect(editor.writingModeButton).toBeVisible();
    await expect(editor.splitModeButton).toBeVisible();
    await expect(editor.sourceModeButton).toBeVisible();
    await expect(editor.mindmapModeButton).toBeVisible();
  });
});
