import { expect, test, type Locator, type Page } from "@playwright/test";

const standardNotesUrl = process.env.E2E_STANDARDNOTES_WEB_URL;
const editorPort = Number(process.env.E2E_PORT ?? 5173);
const editorOrigin = process.env.E2E_EDITOR_ORIGIN ?? `http://127.0.0.1:${editorPort}`;
const editorUrl = new URL("/index.html", editorOrigin).toString();
const defaultManifestUrl = new URL("/e2e/standardnotes-web.ext.json", editorOrigin).toString();
const manifestUrl = process.env.E2E_STANDARDNOTES_MANIFEST_URL ?? defaultManifestUrl;

const reportedMarkdown = `# Inside Out：六大實證心智訓練步驟

## 1. Process｜設定可控制目標
- 核心：不要盯結果，改盯可執行行為。
- 最佳實務：
  - ❌ 30 分鐘內一定修好事故
  - ✅ 先確認影響範圍 → 提出假設 → 一次只驗證一個變因

## 2. Focus｜鎖定任務焦點
- 核心：高壓時只保留 1～2 個 cue。
- 最佳實務：
  - 重訓：把地板往下推
  - 故障排查：Evidence → Hypothesis → Test

## 3. Rehearse｜心理預演
- 核心：同時預演正常流程與失敗後恢復。
- 最佳實務：
  - Demo 前先跑一次正常流程
  - 再預演：網路斷線、服務 timeout、被問到不知道，以及各自的應對方式

## 4. Pressure｜漸進壓力訓練
- 核心：在安全環境逐步加入真實壓力，不要一開始就最大壓力。
- 最佳實務：
  - staging 排障
  - → 限時 30 分鐘
  - → 限時 15 分鐘
  - → 有人旁觀

## 5. Execute｜固定執行程序
- 核心：壓力來時不要臨場發明策略。
- 固定流程：
  - 呼吸 → 看目標 → cue → 執行
- 最佳實務：
  - 下重大指令前：確認 host → environment → command → 執行

## 6. Review｜回饋與修正
- 核心：不要只評價「好／差」，要找下一個可修改行為。
- 最佳實務：
  - 原本預期
  - 實際發生
  - 下次只改一件事

## 一句話記憶
**Process → Focus → Rehearse → Pressure → Execute → Review → 重複**

## 輔助工具
- 呼吸
- Self-talk
- Mindfulness
- Threat → Challenge 壓力重新評估

這些是輔助工具，不是核心流程。

## 核心原則
**能力與自信來自反覆的「執行 → 回饋 → 修正」，而不是單純告訴自己要有自信。**`;

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
  const enabledInstall = page.locator('button:not([disabled])').filter({ hasText: "Install" });
  await expect(enabledInstall).toHaveCount(1);
  await enabledInstall.click();

  await expect(page.getByText("Confirm Extension", { exact: true })).toBeVisible();
  await expect(enabledInstall).toHaveCount(1);
  await enabledInstall.click();
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

async function approveEditorActivationIfNeeded(page: Page): Promise<void> {
  // Standard Notes 3.202.x asks for this separately when an iframe editor is
  // first activated. Newer hosts grant the same permission during install.
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  if (await continueButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await continueButton.click();
  }
}

test.describe("Standard Notes Web host integration", () => {
  // The first webpack-dev-server load of a freshly built Standard Notes
  // checkout can take longer than Playwright's default 30s while it compiles
  // the host's ~40 MB bundle. Subsequent runs are much faster.
  test.setTimeout(120_000);
  test.skip(!standardNotesUrl, "Set E2E_STANDARDNOTES_WEB_URL to a running Standard Notes Web fork.");

  test("installs Markdown Notes+ and honors the real host's read-only lock", async ({ page }) => {
    await page.goto(standardNotesUrl!);
    await prepareOfflineWorkspace(page);
    await installEditor(page);
    await createNoteAndSelectEditor(page);
    await approveEditorActivationIfNeeded(page);

    const editorFrame = page.frameLocator(`iframe[src^="${editorUrl}"]`);
    await expect(editorFrame.locator("#app")).toBeVisible({ timeout: 20_000 });
    await expect(editorFrame.locator(".status")).toHaveText("Ready");

    await editorFrame.getByRole("button", { name: "Source", exact: true }).click();
    const source = editorFrame.locator(".source-pane .cm-content");
    await expect(source).toHaveAttribute("contenteditable", "true");

    // This is a real host-side mutation, not a message injected by the test.
    // Standard Notes updates the note's `locked` appData and streams it to the
    // already-running editor iframe.
    await preventEditingInHost(page);
    await expect(editorFrame.locator(".status")).toHaveText("Locked · read-only");

    const lockedSource = source;
    await expect(lockedSource).toHaveAttribute("contenteditable", "false");
    const textBeforeAttempt = await lockedSource.textContent();
    await page.keyboard.press("Escape");
    await lockedSource.click();
    await page.keyboard.type(" This must not be saved.");
    await expect(lockedSource).toHaveText(textBeforeAttempt ?? "");
  });

  test("requires Writing normalization for the reported Chinese Markdown", async ({ page }) => {
    test.setTimeout(20_000);
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto(standardNotesUrl!);
    await prepareOfflineWorkspace(page);
    await installEditor(page);
    await createNoteAndSelectEditor(page);
    await approveEditorActivationIfNeeded(page);

    const editorFrame = page.frameLocator(`iframe[src^="${editorUrl}"]`);
    await expect(editorFrame.locator("#app")).toBeVisible({ timeout: 20_000 });
    await editorFrame.getByRole("button", { name: "Source", exact: true }).click();

    const source = editorFrame.locator(".source-pane .cm-content");
    await source.click();
    // Give CodeMirror the same one-transaction payload it receives for a
    // paste. The host iframe blocks the Clipboard API by permissions policy,
    // so Playwright cannot populate the system clipboard from this frame.
    await source.evaluate((element, markdown) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", markdown);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, reportedMarkdown);
    // CodeMirror renders logical newlines as separate `.cm-line` elements,
    // so a parent `textContent` intentionally has no newline characters.
    await expect(source.locator(".cm-line")).toHaveText(reportedMarkdown.split("\n"));
    await expect(editorFrame.locator(".status")).not.toContainText("fallback");

    await editorFrame.getByRole("button", { name: "Writing", exact: true }).click();
    const normalization = editorFrame.getByRole("dialog", { name: "Writing normalization required" });
    await expect(normalization).toBeVisible();
    await expect(normalization).toContainText("blank-line: 9, final-newline: 1");
    const leaveInSource = normalization.getByRole("button", { name: "留在 Source", exact: true });
    await expect(leaveInSource).toBeInViewport();
    await leaveInSource.click();
    await expect(normalization).toBeHidden();
    await expect(editorFrame.locator(".source-pane")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
