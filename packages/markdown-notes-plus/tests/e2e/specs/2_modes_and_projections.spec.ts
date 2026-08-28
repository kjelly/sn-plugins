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
});
