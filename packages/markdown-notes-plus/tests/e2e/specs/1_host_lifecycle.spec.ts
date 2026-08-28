import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Host Protocol & Lifecycle", () => {
  test("Handshake initializes the editor with the note content and metadata", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const initialMarkdown = "# Note Title\n\nParagraph text.\n";
    await host.goto(initialMarkdown, "note-uuid-1", false);

    // Verify status is Ready
    await expect(editor.status).toHaveText("Ready");

    // Verify footer reflects counts
    await expect(editor.footerMeta).toContainText("0 tasks");
    await expect(editor.footerMeta).toContainText("1 section");

    // Verify outline panel has heading
    await expect(editor.outlineHeadings).toHaveCount(1);
    await expect(editor.outlineHeadings.first()).toHaveText("Note Title");
  });

  test("Local changes trigger a debounced save (300ms) with updated text", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Initial Content\n", "note-uuid-save", false);
    await editor.switchMode("Source");

    // Type in Source editor
    await editor.sourceEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("\n\nNew paragraph line.");

    // Status changes to Edited · save pending
    await expect(editor.status).toHaveText(/Edited · save/);

    // Wait for the debounced save to arrive at mock host
    const savePromise = host.waitForNextSave(4000);
    await savePromise;

    const savedText = await host.getLatestSavedText();
    expect(savedText).toContain("New paragraph line.");
  });

  test("Note locked state disables editing and updates status", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Locked Note\n\nParagraph.\n", "note-uuid-locked", false);
    await expect(editor.status).toHaveText("Ready");

    // Host updates note lock to true
    await host.setLocked(true);

    // Status changes to Locked · read-only
    await expect(editor.status).toHaveText("Locked · read-only");

    // Toolbar buttons are disabled
    await expect(editor.writingH1Button).toBeDisabled();
    await expect(editor.writingTableButton).toBeDisabled();
    await expect(editor.undoButton).toBeDisabled();
    await expect(editor.redoButton).toBeDisabled();

    // Unlock note restores Ready
    await host.setLocked(false);
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.writingH1Button).toBeEnabled();
  });

  test("Remote update arrives when note is clean -> automatically updates canonical document", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Original Title\n\nInitial.\n", "note-uuid-remote-clean", false);
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.outlineHeadings.first()).toHaveText("Original Title");

    // Host updates note remotely
    await host.updateCurrentNote("# Updated Remote Title\n\nUpdated.\n");

    // Outline should reflect new remote title without conflict banner
    await expect(editor.outlineHeadings.first()).toHaveText("Updated Remote Title");
    await expect(editor.conflictBanner).toHaveCount(0);
    await expect(editor.status).toHaveText("Ready");
  });

  test("Remote update arrives when note is dirty -> displays conflict resolution banner", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Base Note\n", "note-uuid-conflict", false);
    await editor.switchMode("Source");

    // Make a local edit to make it dirty
    await editor.sourceEditor.click();
    await page.keyboard.type(" [Local Modification]");

    // Host sends conflicting remote update
    await host.updateCurrentNote("# Conflicting Remote Note Content\n");

    // Conflict banner appears
    await expect(editor.conflictBanner).toBeVisible();
    await expect(editor.conflictBanner).toContainText("Another device changed this note.");
    await expect(editor.keepLocalButton).toBeVisible();
    await expect(editor.acceptRemoteButton).toBeVisible();

    // Test resolving conflict by keeping local
    await editor.keepLocalButton.click();
    await expect(editor.conflictBanner).toHaveCount(0);
  });
});
