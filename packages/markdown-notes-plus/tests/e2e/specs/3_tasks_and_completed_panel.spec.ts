import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Tasks and Completed Panel", () => {
  test("Completed panel accurately tracks completed tasks and supports Uncheck and Delete", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Task List\n\n- [ ] Pending item\n- [x] Finished item 1\n- [x] Finished item 2\n";
    await host.goto(doc, "note-tasks-1", false);

    // Switch to Tasks tab
    await editor.openTasksTab();

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

    await editor.openTasksTab();

    await expect(editor.completedCountHeading).toHaveText("Completed (3)");

    // Test Uncheck all
    await editor.uncheckAllButton.click();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");

    await editor.switchMode("Source");
    const sourceText = await editor.getSourceText();
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

    await editor.openTasksTab();

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

  test("Writing mode task creation, in-editor checkbox toggle, and split integrated mode synchronization", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Project\n\nBuy milk\n", "note-task-writing", false);

    await editor.openTasksTab();

    // Click into paragraph
    await editor.writingEditor.locator("p").click();

    // Click Task toolbar button to convert paragraph to task
    await editor.writingTaskButton.click();
    const taskItem = editor.writingEditor.locator('li[data-item-type="task"]');
    await expect(taskItem).toBeVisible();

    // Check the task by clicking checkbox inside Writing editor
    const checkbox = taskItem.locator('input[type="checkbox"]');
    await checkbox.click();

    // Completed tasks panel detects the checked task
    await expect(editor.completedCountHeading).toHaveText("Completed (1)");
    // In Writing editor, completed task remains visible with checked state
    await expect(taskItem).toHaveAttribute("data-checked", "true");
    await expect(checkbox).toBeChecked();

    // Verify SVG checkmark background image is applied to the checked checkbox
    const bgImage = await checkbox.evaluate((el) => window.getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain("data:image/svg+xml");
    expect(bgImage).toContain("polyline");

    // Switch to Split mode (integrated Writing + Mindmap)
    await editor.switchMode("Split");
    await expect(editor.writingPane).toBeVisible();
    await expect(editor.mindmapPane).toBeVisible();

    // Uncheck task in Writing pane within Split mode
    await checkbox.click();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");
    await expect(taskItem).toHaveAttribute("data-checked", "false");
    await expect(checkbox).not.toBeChecked();
  });

  test("Outline section task batch actions and grouped completed tasks batch actions", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = `# Sprint A
- [ ] Task A1
- [ ] Task A2

# Sprint B
- [x] Task B1
- [x] Task B2
`;
    await host.goto(doc, "note-tasks-section-batch", false);

    // 1. Verify Outline displays section badges
    await editor.openOutlineTab();
    const outlineItems = editor.outlinePanel.locator("ol li");
    await expect(outlineItems).toHaveCount(2);

    const sprintABadge = outlineItems.nth(0).locator(".section-task-badge");
    await expect(sprintABadge).toHaveText("0/2");

    const sprintBBadge = outlineItems.nth(1).locator(".section-task-badge");
    await expect(sprintBBadge).toHaveText("2/2");

    // 2. Click "Check all in section" for Sprint A
    const checkAllSprintA = outlineItems.nth(0).locator('.section-task-actions button[title="Check all in this section"]');
    await checkAllSprintA.click();

    // Switch to Tasks tab to verify total completed is 4
    await editor.openTasksTab();
    await expect(editor.completedCountHeading).toHaveText("Completed (4)");

    // Switch back to Outline tab to check badge
    await editor.openOutlineTab();
    await expect(sprintABadge).toHaveText("2/2");

    // 3. Test grouped tasks panel batch action: Uncheck Sprint A group
    await editor.openTasksTab();
    const sprintAGroup = editor.tasksPanel.locator('.task-group:has-text("Sprint A")');
    await expect(sprintAGroup).toBeVisible();
    const uncheckSprintAGroupBtn = sprintAGroup.locator('.task-group-actions button[title="Uncheck all in this group"]');
    await uncheckSprintAGroupBtn.click();

    // Completed decreases to 2 (Sprint B only)
    await expect(editor.completedCountHeading).toHaveText("Completed (2)");

    // Switch back to Outline tab to check badge
    await editor.openOutlineTab();
    await expect(sprintABadge).toHaveText("0/2");

    // 4. Test Outline section batch action: Delete completed in Sprint B
    const deleteCompletedSprintB = outlineItems.nth(1).locator('.section-task-actions button.delete-btn');
    await deleteCompletedSprintB.click();

    // Switch to Tasks tab to check count
    await editor.openTasksTab();
    await expect(editor.completedCountHeading).toHaveText("Completed (0)");

    await editor.openOutlineTab();
    await expect(outlineItems.nth(1).locator(".section-task-badge")).toHaveCount(0);

    // Verify in Source mode
    await editor.switchMode("Source");
    const sourceText = await editor.getSourceText();
    expect(sourceText).toContain("# Sprint A");
    expect(sourceText).toContain("- [ ] Task A1");
    expect(sourceText).toContain("- [ ] Task A2");
    expect(sourceText).toContain("# Sprint B");
    expect(sourceText).not.toContain("Task B1");
    expect(sourceText).not.toContain("Task B2");
  });
});
