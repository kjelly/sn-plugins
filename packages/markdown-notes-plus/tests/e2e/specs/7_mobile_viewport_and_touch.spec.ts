import { test, expect, type Page } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

type CspViolation = {
  blockedURI: string;
  violatedDirective: string;
};

type CspAuditedWindow = Window & {
  __snMobileCspViolations?: CspViolation[];
};

async function installCspAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const auditedWindow = window as CspAuditedWindow;
    auditedWindow.__snMobileCspViolations = [];
    self.addEventListener("securitypolicyviolation", (event) => {
      // Vite's development HMR socket is intentionally outside the editor CSP
      // allowlist; the production-preview run below is the CSP gate.
      if (event.blockedURI.startsWith("ws://127.0.0.1:5173/?token=")) return;
      auditedWindow.__snMobileCspViolations?.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
      });
    });
  });
}

async function readCspViolations(editor: EditorPage): Promise<{ host: CspViolation[]; editor: CspViolation[] }> {
  const host = await editor.page.evaluate(() => (window as CspAuditedWindow).__snMobileCspViolations ?? []);
  const inner = await editor.frame.locator("html").evaluate(() => (window as CspAuditedWindow).__snMobileCspViolations ?? []);
  return { host, editor: inner };
}

const coarseControlSelector = [
  ".writing-pane .pane-toolbar button",
  ".sidebar-toggle-btn",
  ".sidebar-close-btn",
  ".sidebar-tab-btn",
  ".outline-panel-controls button",
  ".outline-fold-toggle",
  ".outline-panel li .outline-heading-btn",
  ".outline-action-btn",
  ".section-task-actions button",
  ".milkdown-writing li[data-item-type=\"task\"] .task-checkbox",
  ".milkdown-writing li[data-item-type=\"task\"] .task-delete",
].join(", ");

async function expectTouchTargetBounds(editor: EditorPage, selector: string): Promise<void> {
  const bounds = await editor.frame.locator(selector).evaluateAll((controls) => controls.map((control) => {
    const rect = control.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(bounds.length).toBeGreaterThan(0);
  for (const bound of bounds) {
    expect(bound.width).toBeGreaterThanOrEqual(40);
    expect(bound.height).toBeGreaterThanOrEqual(40);
  }
}

test.describe("Mobile Viewport & Touch Ergonomics", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("Mobile shell publishes visual viewport height and keeps a usable fallback", async ({ page }) => {
    await installCspAudit(page);
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Viewport test\n\nContent.\n", "note-mobile-viewport", false);
    await expect(editor.status).toHaveText("Ready");

    const outerFrame = await page.locator("#editor-frame").boundingBox();
    expect(outerFrame).not.toBeNull();
    expect(outerFrame!.width).toBe(390);
    expect(outerFrame!.height).toBe(844);

    const viewportState = await editor.frame.locator(".app-shell").evaluate((shell) => ({
      innerWidth,
      innerHeight,
      documentWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.clientHeight,
      shellWidth: shell.getBoundingClientRect().width,
      shellHeight: shell.getBoundingClientRect().height,
      published: document.documentElement.style.getPropertyValue("--vvh"),
      height: getComputedStyle(shell).height,
    }));
    expect(viewportState.innerWidth).toBe(390);
    expect(viewportState.innerHeight).toBe(844);
    expect(viewportState.documentWidth).toBe(390);
    expect(viewportState.documentHeight).toBe(844);
    expect(viewportState.shellWidth).toBe(390);
    expect(viewportState.shellHeight).toBe(844);
    expect(viewportState.height).toMatch(/px$/);
    expect(viewportState.published).toBe(`${viewportState.innerHeight}px`);

    await editor.page.setViewportSize({ width: 390, height: 700 });
    await expect.poll(() => editor.frame.locator(".app-shell").evaluate(() => ({
      innerHeight,
      published: document.documentElement.style.getPropertyValue("--vvh"),
    }))).toEqual({ innerHeight: 700, published: "700px" });

    const cspViolations = await readCspViolations(editor);
    expect(cspViolations.host).toEqual([]);
    expect(cspViolations.editor).toEqual([]);
  });

  test("Coarse-pointer outline and task controls expose 40px touch targets", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Touch controls\n\n## Section\n\n- [ ] Open touch task\n- [x] Completed touch task\n", "note-mobile-controls", false);
    await expect(editor.status).toHaveText("Ready");
    const isCoarsePointer = await editor.frame.locator("body").evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(isCoarsePointer).toBe(true);
    await editor.openSidebar();

    await expectTouchTargetBounds(editor, coarseControlSelector);
    await expect(editor.frame.locator(".outline-structural-actions").first()).toBeVisible();

    await editor.tasksTabBtn.click();
    await expect(editor.tasksPanel).toBeVisible();
    await expectTouchTargetBounds(editor, ".tasks-panel .panel-heading button, .task-group-actions button, .task-actions button, .tasks-panel .actions button");
  });

  test("Link dialog keeps invalid input open, cancels exactly, and confirms a safe URL", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Selected text\n", "note-mobile-link-dialog", false);
    await expect(editor.status).toHaveText("Ready");
    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await editor.writingLinkButton.click();

    const dialog = editor.frame.getByRole("dialog", { name: "Insert link" });
    const input = dialog.locator("#link-dialog-url");
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("font-size", "16px");
    await expectTouchTargetBounds(editor, ".link-dialog-actions button");
    await input.fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a safe link URL.");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("Selected text");
    await expect(editor.sourceEditor).not.toContainText("javascript:");

    await editor.switchMode("Writing");
    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await editor.writingLinkButton.click();
    await expect(dialog).toBeVisible();
    await input.fill("https://confirm.example/selected");
    const savePromise = host.waitForNextSave(4000);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await savePromise;
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("[Selected text](https://confirm.example/selected)");
  });

  test("Locked Writing does not open or apply a link dialog", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Locked text\n", "note-mobile-locked-link", true);
    await expect(editor.status).toHaveText("Locked · read-only");
    await expect(editor.writingLinkButton).toBeDisabled();
    await expect(editor.frame.getByRole("dialog", { name: "Insert link" })).not.toBeVisible();
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("Locked text");
  });

  test("Link dialog ignores a remote replacement that arrives while it is open", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Stale local text\n", "note-mobile-stale-link", false);
    await expect(editor.status).toHaveText("Ready");
    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await editor.writingLinkButton.click();

    const dialog = editor.frame.getByRole("dialog", { name: "Insert link" });
    await expect(dialog).toBeVisible();
    await host.updateCurrentNote("Remote replacement\n");
    await expect(editor.writingEditor).toContainText("Remote replacement");
    await dialog.locator("#link-dialog-url").fill("https://stale.example");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("Remote replacement");
    await expect(editor.sourceEditor).not.toContainText("stale.example");
  });

  test("Link dialog refuses to write after the note becomes locked", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("Lockable text\n", "note-mobile-lock-after-dialog", false);
    await expect(editor.status).toHaveText("Ready");
    await editor.writingEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await editor.writingLinkButton.click();

    const dialog = editor.frame.getByRole("dialog", { name: "Insert link" });
    await expect(dialog).toBeVisible();
    await host.setLocked(true);
    await expect(editor.status).toHaveText("Locked · read-only");
    await dialog.locator("#link-dialog-url").fill("https://locked.example");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("Lockable text");
    await expect(editor.sourceEditor).not.toContainText("locked.example");
  });

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

  test("Mobile outline navigation keeps the sidebar closed across the desktop breakpoint", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Section Alpha\n\nAlpha body text.\n\n## Section Beta\n\nBeta body text.\n", "note-mobile-sidebar-breakpoint", false);

    await expect(editor.status).toHaveText("Ready");
    await editor.openSidebar();
    await expect(editor.outlineHeadings).toHaveCount(2);

    await editor.outlineHeadings.nth(1).click();
    await expect(editor.sidebarPane).not.toBeVisible();

    await page.setViewportSize({ width: 901, height: 844 });
    await expect(editor.sidebarPane).not.toBeVisible();
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
