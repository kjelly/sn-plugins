import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Recurring Tasks with @repeat and @done", () => {
  test("Writing mode - checking a @repeat task appends @done(YYYY-MM-DD)", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Habits\n\n- [ ] Morning run @repeat(daily)\n- [ ] Read book\n", "habits-1");

    const checkbox = editor.writingPane.locator(".task-checkbox").first();
    const savePromise = host.waitForNextSave();
    await checkbox.click();
    await savePromise;
    const saved = await host.getLatestSavedText();
    expect(saved).toMatch(/- \[x\] Morning run @repeat\(daily\) @done\(\d{4}-\d{2}-\d{2}\)/);
    expect(saved).toContain("- [ ] Read book");
  });

  test("Writing mode - unchecking a completed @repeat task removes @done tag", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Habits\n\n- [x] Morning run @repeat(7d) @done(2026-08-29)\n- [x] Read book\n", "habits-2");

    const checkbox = editor.writingPane.locator(".task-checkbox").first();
    const savePromise = host.waitForNextSave();
    await checkbox.click();
    await savePromise;
    const saved = await host.getLatestSavedText();
    expect(saved).toContain("- [ ] Morning run @repeat(7d)");
    expect(saved).not.toContain("@done");
    expect(saved).toContain("- [x] Read book");
  });

  test("Note load - auto-resets overdue recurring tasks to unchecked state", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // Provide note with overdue task from 2026-08-20 with repeat(3d)
    const overdueContent = "# Routine\n\n- [x] Water plants @repeat(3d) @done(2026-08-20)\n- [x] One-time done task\n";
    await host.goto(overdueContent, "routine-1");

    // Check Writing pane reflects unchecked state
    const firstCheckbox = editor.writingPane.locator(".task-checkbox").first();
    await expect(firstCheckbox).not.toBeChecked();

    const secondCheckbox = editor.writingPane.locator(".task-checkbox").nth(1);
    await expect(secondCheckbox).toBeChecked();

    // Verify saved content has been auto-reset
    await page.waitForTimeout(500);
    const saved = await host.getLatestSavedText();
    expect(saved).toContain("- [ ] Water plants @repeat(3d)");
    expect(saved).not.toContain("@done(2026-08-20)");
    expect(saved).toContain("- [x] One-time done task");
  });

  test("Mindmap mode - toggling recurring task checkbox updates @done tag", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Routine\n\n## Tasks\n- [ ] Weekly review @repeat(1w)\n", "routine-2");
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    const checkbox = editor.mindmapSvg.locator('foreignObject svg[viewBox="0 -3 24 24"]').first();
    await expect(checkbox).toBeVisible();
    const savePromise = host.waitForNextSave();
    await checkbox.click();
    await savePromise;
    const saved = await host.getLatestSavedText();
    expect(saved).toMatch(/- \[x\] Weekly review @repeat\(1w\) @done\(\d{4}-\d{2}-\d{2}\)/);
  });
});
