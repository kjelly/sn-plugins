import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Mobile Viewport & Touch Ergonomics", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Mobile viewport initializes with collapsed sidebar giving 100% space to editor", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Mobile Title\n\n- [ ] Task 1\n\n## Subheading\n\nContent paragraph.\n", "note-mobile-1", false);

    // Wait for Writing editor ready
    await expect(editor.status).toHaveText("Ready");

    // Sidebar should be collapsed by default on mobile
    await expect(editor.sidebarPane).not.toBeVisible();
    await expect(editor.workspaceLayout).toHaveClass(/sidebar-collapsed/);

    // Writing editor should be visible and occupy nearly full mobile width
    await expect(editor.writingEditor).toBeVisible();
    const box = await editor.writingEditor.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(320);
  });

  test("Mobile sidebar opens as drawer with close button and backdrop, and auto-dismisses on heading selection", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Section Alpha\n\nAlpha body text.\n\n## Section Beta\n\nBeta body text.\n", "note-mobile-drawer", false);

    await expect(editor.status).toHaveText("Ready");
    await expect(editor.sidebarPane).not.toBeVisible();

    // Tap Sidebar toggle in toolbar
    await editor.sidebarToggleBtn.click();

    // Drawer and controls appear
    await expect(editor.sidebarPane).toBeVisible();
    await expect(editor.sidebarCloseBtn).toBeVisible();
    await expect(editor.sidebarBackdrop).toBeVisible();

    // Tap close button (✕)
    await editor.sidebarCloseBtn.click();
    await expect(editor.sidebarPane).not.toBeVisible();

    // Reopen and test backdrop click to dismiss
    await editor.sidebarToggleBtn.click();
    await expect(editor.sidebarPane).toBeVisible();
    await editor.sidebarBackdrop.click({ position: { x: 10, y: 10 } });
    await expect(editor.sidebarPane).not.toBeVisible();

    // Reopen and test clicking an Outline heading auto-closes the sidebar drawer
    await editor.sidebarToggleBtn.click();
    await expect(editor.sidebarPane).toBeVisible();
    await expect(editor.outlineHeadings).toHaveCount(2);

    await editor.outlineHeadings.nth(1).click();
    // Sidebar should automatically close on heading navigation
    await expect(editor.sidebarPane).not.toBeVisible();
    // Source editor should be displayed
    await expect(editor.sourceEditor).toBeVisible();
    await expect(editor.sourceEditor).toContainText("Section Beta");
  });

  test("Mobile task checkbox click updates state smoothly", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("- [ ] Mobile Grocery Run\n", "note-mobile-task", false);

    await expect(editor.status).toHaveText("Ready");

    const checkbox = editor.writingEditor.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    // Tap checkbox
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Switch to Source mode to verify markdown
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("- [x] Mobile Grocery Run");
  });
});
