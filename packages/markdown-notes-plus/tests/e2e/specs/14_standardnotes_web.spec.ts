import { expect, test, type Locator, type Page } from "@playwright/test";

const standardNotesUrl = process.env.E2E_STANDARDNOTES_WEB_URL;
const editorPort = Number(process.env.E2E_PORT ?? 5173);
const editorOrigin = process.env.E2E_EDITOR_ORIGIN ?? `http://127.0.0.1:${editorPort}`;
const editorUrl = new URL("/index.html", editorOrigin).toString();
const defaultManifestUrl = new URL("/e2e/standardnotes-web.ext.json", editorOrigin).toString();
const manifestUrl = process.env.E2E_STANDARDNOTES_MANIFEST_URL ?? defaultManifestUrl;

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return undefined;
}

async function prepareOfflineWorkspace(page: Page): Promise<void> {
  const offlineButton = await firstVisible(page, [
    'button:has-text("Use Offline")',
    'button:has-text("Use offline")',
  ]);
  if (offlineButton) await offlineButton.click();

  await expect
    .poll(async () => Boolean(await firstVisible(page, [
      '[aria-label^="Create a new note"]',
      'button[title="Create new note"]',
    ])), { timeout: 60_000 })
    .toBe(true);
}

async function installEditor(page: Page): Promise<void> {
  const preferences = await firstVisible(page, [
    '[aria-label^="Open preferences"]',
    'button[title="Open preferences"]',
    'button:has-text("Preferences")',
    // Desktop's PreferencesButton is intentionally icon-only; the footer
    // order is Account, Preferences, Quick Settings, Vault.
    '#footer-bar .left > div:nth-child(2) button',
  ]);
  if (!preferences) throw new Error("Standard Notes Preferences entry was not found");
  await preferences.click();

  const plugins = await firstVisible(page, [
    '[role="button"]:has-text("Plugins")',
    'button:has-text("Plugins")',
    '[role="tab"]:has-text("Plugins")',
    '.preferences-menu-item:has-text("Plugins")',
  ]);
  if (!plugins) throw new Error("Standard Notes Plugins preference pane was not found");
  await plugins.click();

  const pluginUrl = page.getByPlaceholder("Enter Plugin URL");
  await expect(pluginUrl).toBeVisible();
  await pluginUrl.fill(manifestUrl);
  await page.getByRole("button", { name: "Install", exact: true }).click();

  await expect(page.getByText("Confirm Extension", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(pluginUrl).toBeVisible();
  await expect(pluginUrl).toHaveValue("");
  await page.getByRole("button", { name: "Close preferences" }).click();
}

async function createNoteAndSelectEditor(page: Page): Promise<void> {
  const createNote = await firstVisible(page, [
    '[aria-label^="Create a new note"]',
    'button[title="Create new note"]',
  ]);
  if (!createNote) throw new Error("Standard Notes create-note action was not found");
  await createNote.click();

  const changeEditor = await firstVisible(page, [
    '[aria-label^="Change note type"]',
    'button[title="Change note type"]',
  ]);
  if (!changeEditor) throw new Error("Standard Notes change-note-type action was not found");
  await changeEditor.click();
  await page.getByText("Markdown Notes+", { exact: true }).last().click();
}

async function preventEditingInHost(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Note options menu", exact: true }).click();
  const preventEditing = page.getByRole("menuitemcheckbox", { name: "Prevent editing", exact: true });
  await expect(preventEditing).toHaveAttribute("aria-checked", "false");
  await preventEditing.click();
  await expect(preventEditing).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Note editing disabled.", { exact: true })).toBeVisible();
}

test.describe("Standard Notes Web host integration", () => {
  // The first webpack-dev-server load of a freshly built Standard Notes
  // checkout can take longer than Playwright's default 30s while it compiles
  // the host's ~40 MB bundle. Subsequent runs are much faster.
  test.setTimeout(120_000);
  test.skip(!standardNotesUrl, "Set E2E_STANDARDNOTES_WEB_URL to a running Standard Notes Web fork.");

  test("installs Markdown Notes+, saves through the real host, and honors its read-only lock", async ({ page }) => {
    await page.goto(standardNotesUrl!);
    await prepareOfflineWorkspace(page);
    await installEditor(page);
    await createNoteAndSelectEditor(page);

    const editorFrame = page.frameLocator(`iframe[src^="${editorUrl}"]`);
    await expect(editorFrame.locator("#app")).toBeVisible({ timeout: 20_000 });
    await expect(editorFrame.locator(".status")).toHaveText("Ready");

    await editorFrame.getByRole("button", { name: "Source" }).click();
    const source = editorFrame.locator(".source-pane .cm-content");
    await source.click();
    await page.keyboard.type("# Standard Notes Web E2E\n\nSaved by the real host.");

    await expect(editorFrame.locator(".source-pane .cm-content")).toContainText("Saved by the real host.");
    await expect(editorFrame.locator(".status")).toHaveText(/save requested|Ready/, { timeout: 10_000 });

    // Reloading the real host is the minimum persistence boundary: it makes
    // the host rebuild the component iframe from its stored note, rather than
    // merely asserting the editor's local CodeMirror state.
    await page.reload();
    const reloadedEditorFrame = page.frameLocator(`iframe[src^="${editorUrl}"]`);
    await expect(reloadedEditorFrame.locator("#app")).toBeVisible({ timeout: 20_000 });
    await reloadedEditorFrame.getByRole("button", { name: "Source" }).click();
    await expect(reloadedEditorFrame.locator(".source-pane .cm-content")).toContainText("Saved by the real host.");

    // This is a real host-side mutation, not a message injected by the test.
    // Standard Notes updates the note's `locked` appData and streams it to the
    // already-running editor iframe.
    await preventEditingInHost(page);
    await expect(reloadedEditorFrame.locator(".status")).toHaveText("Locked · read-only");

    const lockedSource = reloadedEditorFrame.locator(".source-pane .cm-content");
    await expect(lockedSource).toHaveAttribute("contenteditable", "false");
    const textBeforeAttempt = await lockedSource.textContent();
    await lockedSource.click();
    await page.keyboard.type(" This must not be saved.");
    await expect(lockedSource).toHaveText(textBeforeAttempt ?? "");
  });
});
