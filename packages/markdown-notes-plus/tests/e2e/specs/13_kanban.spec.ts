import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Kanban projection", () => {
  test("enters Kanban, renders four columns, and moves a card in canonical Markdown", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const document = "# Project Board\n\n## Backlog\n\n- [ ] Draft proposal\n\n## Doing\n\n- [ ] Build prototype\n\n## Review\n\n## Done\n";

    await host.goto(document, "note-kanban-e2e", false);
    await expect(editor.kanbanModeButton).toBeVisible();

    await editor.switchMode("Kanban");
    await expect(editor.kanbanPane).toBeVisible();
    await expect(editor.kanbanColumns).toHaveCount(4);
    await expect(editor.kanbanColumns.nth(0)).toHaveAttribute("aria-label", "Backlog");
    await expect(editor.kanbanColumns.nth(1)).toHaveAttribute("aria-label", "Doing");
    await expect(editor.kanbanColumns.nth(2)).toHaveAttribute("aria-label", "Review");
    await expect(editor.kanbanColumns.nth(3)).toHaveAttribute("aria-label", "Done");

    const savePromise = host.waitForNextSave(5000);
    await editor.kanbanCard("Draft proposal").dragTo(editor.kanbanDropZones.nth(2));
    await expect.poll(() => editor.kanbanColumns.nth(2).textContent()).toContain("Draft proposal");
    await expect(editor.kanbanColumns.nth(0).locator(".kanban-card", { hasText: "Draft proposal" })).toHaveCount(0);

    await savePromise;
    const sourceText = await host.getLatestSavedText();
    expect(sourceText).toContain("## Review\n- [ ] Draft proposal");
    expect(sourceText).not.toContain("## Backlog\n\n- [ ] Draft proposal");
  });

  test("moves a card into an empty final column when the source has no final newline", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const document = "# Project Board\n\n## Backlog\n\n- [ ] Draft proposal\n\n## Doing\n\n## Review\n\n## Done";

    await host.goto(document, "note-kanban-eof-e2e", false);
    const normalizationDialog = editor.frame.getByRole("dialog", { name: "Writing normalization required" });
    await expect(normalizationDialog).toBeVisible();
    await editor.switchMode("Kanban");
    await expect(normalizationDialog).toBeHidden();
    await expect(editor.kanbanPane).toBeVisible();

    const savePromise = host.waitForNextSave(5000);
    await editor.kanbanCard("Draft proposal").dragTo(editor.kanbanDropZones.nth(3));
    await savePromise;

    await expect.poll(() => editor.kanbanColumns.nth(3).textContent()).toContain("Draft proposal");
    expect(await host.getLatestSavedText()).toBe("# Project Board\n\n## Backlog\n\n\n## Doing\n\n## Review\n\n## Done\n- [ ] Draft proposal\n");
  });
});
