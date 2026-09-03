import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Full Integrated Workflow", () => {
  test.use({ viewport: { width: 700, height: 900 }, hasTouch: true });

  test("Complete multi-mode workflow: rich editing, task lifecycle, split projection, mindmap filtering, and debounced host sync", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const initialContent = "# Product Roadmap\n\n## Backend Infrastructure\n\n- [ ] Deploy database cluster\n- [x] Configure SSL certificates\n\n## Frontend Features\n\n- [ ] Build navigation sidebar\n- [x] Setup dark mode theme\n\n## Architecture\n\nCore services and message queues\n";
    await host.goto(initialContent, "note-integrated-flow", false);

    // 1. Initial verification in Writing Mode
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.writingPane).toBeVisible();
    await editor.openOutlineTab();
    await expect(editor.outlineHeadings).toHaveCount(4);
    await editor.openTasksTab();
    await expect(editor.completedCountHeading).toHaveText("Completed (2)");
    await expect(editor.footerMeta).toContainText("4 tasks");
    await expect(editor.footerMeta).toContainText("4 sections");
    await editor.closeSidebar();

    // 2. Rich writing tools: Add quote in Writing Mode
    await editor.writingEditor.locator("p").last().click();
    await editor.writingQuoteButton.click();
    await expect(editor.writingEditor.locator("blockquote")).toBeVisible();

    // 3. Task interaction in Writing Mode: Check an open task
    const taskItems = editor.writingEditor.locator('li[data-item-type="task"]');
    const firstCheckbox = taskItems.first().locator('input[type="checkbox"]');
    await firstCheckbox.click();
    await editor.openTasksTab();
    await expect(editor.completedCountHeading).toHaveText("Completed (3)");

    // 4. Switch to Split Mode (Writing + Mindmap)
    await editor.switchMode("Split");
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.mindmapPane).toBeVisible();
    await expect(editor.mindmapSvg).toBeVisible();

    // Verify Mind Map renders headings
    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Product Roadmap");

    const svgHtml = await editor.mindmapSvg.innerHTML();
    expect(svgHtml).toContain("Backend Infrastructure");
    expect(svgHtml).toContain("Frontend Features");

    // 5. Mind Map Task Filter in Split Mode
    await editor.mindmapFilterSelect.selectOption("open");
    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).not.toContain("Configure SSL certificates");

    // 6. Bulk Action in Completed Tasks Panel: Uncheck All
    await editor.openTasksTab();
    await editor.uncheckAllButton.click();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");

    // Mind Map filter "open" now includes all previously checked tasks
    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Configure SSL certificates");

    // 7. Outline Section Navigation to Source Mode
    await editor.openOutlineTab();
    // The coarse-pointer layout deliberately enlarges the adjacent structural
    // controls. Invoke the heading button directly so pointer hover cannot
    // shift those controls under the intended selection target.
    await editor.outlineHeadings.nth(2).locator("..").evaluate((button) => {
      (button as HTMLButtonElement).click();
    }); // Frontend Features
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.currentSection).toContainText("Frontend Features");

    // 8. Source Mode Edit with Search Panel and Debounced Save
    await editor.sourceSearchButton.click();
    await expect(editor.sourceSearchPanel).toBeVisible();

    const savePromise = host.waitForNextSave(5000);
    await editor.sourceEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("\n- [ ] Mobile responsive layout\n");
    await savePromise;

    const savedText = await host.getLatestSavedText();
    expect(savedText).toContain("Mobile responsive layout");

    // 9. Host Lock State Transition
    await host.setLocked(true);
    await expect(editor.status).toHaveText("Locked · read-only");
    await expect(editor.undoButton).toBeDisabled();
    await expect(editor.redoButton).toBeDisabled();

    await host.setLocked(false);
    if (await editor.conflictBanner.isVisible()) {
      await editor.keepLocalButton.click();
      await expect(editor.conflictBanner).toHaveCount(0);
    }
    await expect(editor.undoButton).toBeEnabled();

    // 10. Writing remains gated after a local Source edit until a later
    // admission proof; the canonical Source content remains intact.
    await editor.switchMode("Writing");
    await expect(editor.sourcePane).toBeVisible();
    await expect(editor.sourceEditor).toContainText("Mobile responsive layout");
    await expect(editor.footerMeta).toContainText("6 tasks");
  });
});
