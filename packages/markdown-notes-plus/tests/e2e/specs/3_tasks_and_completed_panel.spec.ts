import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Tasks and Completed Panel", () => {
  test("Completed panel accurately tracks completed tasks and supports Uncheck and Delete", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Task List\n\n- [ ] Pending item\n- [x] Finished item 1\n- [x] Finished item 2\n";
    await host.goto(doc, "note-tasks-1", false);

    // Verify initial Completed count
    await expect(editor.completedCountHeading).toHaveText("Completed (2)");
    await expect(editor.completedTaskList).toHaveCount(2);
    await expect(editor.completedTaskList.nth(0)).toContainText("Finished item 1");
    await expect(editor.completedTaskList.nth(1)).toContainText("Finished item 2");

    // Uncheck first completed item
    const uncheckFirst = editor.completedTaskList.nth(0).getByRole("button", { name: "Uncheck" });
    await uncheckFirst.click();

    // Completed count decreases to 1
    await expect(editor.completedCountHeading).toHaveText("Completed (1)");
    await expect(editor.completedTaskList).toHaveCount(1);
    await expect(editor.completedTaskList.first()).toContainText("Finished item 2");

    // Verify in Source mode that Finished item 1 is now open: - [ ] Finished item 1
    await editor.switchMode("Source");
    const sourceText = await editor.getSourceText();
    expect(sourceText).toContain("- [ ] Finished item 1");
    expect(sourceText).toContain("- [x] Finished item 2");

    // Switch back to Writing and delete the second completed item
    await editor.switchMode("Writing");
    const deleteRemaining = editor.completedTaskList.first().getByRole("button", { name: "Delete" });
    await deleteRemaining.click();

    // Completed count is now 0
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");
    await expect(editor.completedTaskList).toHaveCount(0);

    // Verify in Source mode that Finished item 2 is deleted
    await editor.switchMode("Source");
    const updatedSource = await editor.getSourceText();
    expect(updatedSource).not.toContain("Finished item 2");
  });

  test("Bulk actions: 'Uncheck all' and 'Delete completed'", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Tasks\n\n- [ ] Todo\n- [x] Done 1\n- [x] Done 2\n- [x] Done 3\n";
    await host.goto(doc, "note-tasks-bulk", false);

    await expect(editor.completedCountHeading).toHaveText("Completed (3)");

    // Test Uncheck all
    await editor.uncheckAllButton.click();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");

    await editor.switchMode("Source");
    let sourceText = await editor.getSourceText();
    expect(sourceText).toContain("- [ ] Done 1");
    expect(sourceText).toContain("- [ ] Done 2");
    expect(sourceText).toContain("- [ ] Done 3");

    // Clear and insert 2 new completed tasks in Source mode
    await editor.sourceEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText("# Tasks\n\n- [ ] Todo\n- [x] Done 1\n- [x] Done 2\n");

    await expect(editor.completedCountHeading).toHaveText("Completed (2)");

    // Test Delete completed
    await editor.deleteCompletedButton.click();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");

    const updatedSource = await editor.getSourceText();
    expect(updatedSource).toContain("- [ ] Todo");
    expect(updatedSource).not.toContain("Done 1");
    expect(updatedSource).not.toContain("Done 2");
  });

  test("Tasks panel can be collapsed and expanded", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Note\n\n- [x] Complete task\n", "note-collapse", false);

    await expect(editor.completedTaskList).toBeVisible();
    await expect(editor.tasksCollapseButton).toHaveText("Hide");

    // Click Hide
    await editor.tasksCollapseButton.click();
    await expect(editor.completedTaskList).toHaveCount(0);
    await expect(editor.tasksCollapseButton).toHaveText("Show");

    // Click Show
    await editor.tasksCollapseButton.click();
    await expect(editor.completedTaskList).toBeVisible();
    await expect(editor.tasksCollapseButton).toHaveText("Hide");
  });
});
