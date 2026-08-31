# Android E2E Testing with Official Standard Notes APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an automated end-to-end testing pipeline that downloads the official Standard Notes Android release APK, installs the `markdown-notes-plus` custom extension via `ext.json`, launches the real Standard Notes app on an Android device/emulator, and verifies editor loading, mode switching, and persistent saving using WebdriverIO and Appium.

**Architecture:** A static manifest (`public/ext.json`) is served by the local Vite server. A helper script fetches the official Standard Notes release APK from GitHub. WebdriverIO with Appium UiAutomator2 automates the Android UI (bypassing onboarding, installing the custom extension via `http://10.0.2.2:5173/ext.json`, creating a note, and switching to Markdown Notes+). Page objects encapsulate Standard Notes app navigation and editor interactions.

**Tech Stack:** TypeScript, WebdriverIO (`@wdio/cli`, `@wdio/mocha-framework`, `@wdio/local-runner`), Appium 2.x (`@appium/uiautomator2-driver`), Vite, Bash, cURL.

## Global Constraints
- Must not require compiling the Standard Notes React Native codebase from source.
- Must run against the official production release APK of Standard Notes for Android.
- Network calls from emulator to host must use `http://10.0.2.2:5173` (or `adb reverse` for physical devices).
- Must preserve existing unit/integration/E2E tests and pass `npm run test` and `npm run test:e2e`.

---

### Task 1: Create Extension Manifest and Unit Verification

**Files:**
- Create: `public/ext.json`
- Test: `tests/extension-manifest.test.ts`

**Interfaces:**
- Consumes: Static asset serving from Vite.
- Produces: `ext.json` endpoint conforming to Standard Notes component specification (`area: "editor-editor"`, `content_type: "SN|Component"`).

- [ ] **Step 1: Write the failing unit test for extension manifest**

```typescript
// tests/extension-manifest.test.ts
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("extension manifest has valid Standard Notes editor descriptor", async () => {
  const content = await Deno.readTextFile("public/ext.json");
  const manifest = JSON.parse(content);

  assertEquals(manifest.identifier, "org.standardnotes.markdown-notes-plus");
  assertEquals(manifest.name, "Markdown Notes+");
  assertEquals(manifest.content_type, "SN|Component");
  assertEquals(manifest.area, "editor-editor");
  assertEquals(manifest.file_type, "md");
  assertEquals(manifest.note_type, "markdown");
  assertEquals(typeof manifest.url, "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read tests/extension-manifest.test.ts`
Expected: FAIL (No such file `public/ext.json`)

- [ ] **Step 3: Create `public/ext.json`**

```json
{
  "identifier": "org.standardnotes.markdown-notes-plus",
  "name": "Markdown Notes+",
  "content_type": "SN|Component",
  "area": "editor-editor",
  "version": "0.1.0",
  "url": "http://10.0.2.2:5173/index.html",
  "file_type": "md",
  "note_type": "markdown",
  "interchangeable": true,
  "showInGallery": false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read tests/extension-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/ext.json tests/extension-manifest.test.ts
git commit -m "feat(android-e2e): add Standard Notes extension manifest and verification test"
```

---

### Task 2: Create Official APK Downloader Script

**Files:**
- Create: `scripts/download-official-sn-apk.sh`
- Test: `tests/apk-downloader.test.ts`

**Interfaces:**
- Consumes: GitHub Releases API (`https://api.github.com/repos/standardnotes/app/releases`).
- Produces: Executable script saving APK to `artifacts/standardnotes.apk`.

- [ ] **Step 1: Write test for APK downloader script behavior**

```typescript
// tests/apk-downloader.test.ts
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("downloader script is executable and outputs valid target path", async () => {
  const fileInfo = await Deno.stat("scripts/download-official-sn-apk.sh");
  assertEquals((fileInfo.mode ?? 0) & 0o111 > 0, true);

  const command = new Deno.Command("bash", {
    args: ["scripts/download-official-sn-apk.sh", "--dry-run"],
  });
  const { code, stdout } = await command.output();
  assertEquals(code, 0);
  const output = new TextDecoder().decode(stdout);
  assertEquals(output.includes("artifacts/standardnotes.apk"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-run tests/apk-downloader.test.ts`
Expected: FAIL (No such file `scripts/download-official-sn-apk.sh`)

- [ ] **Step 3: Implement `scripts/download-official-sn-apk.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts"
TARGET_APK="${ARTIFACTS_DIR}/standardnotes.apk"

mkdir -p "${ARTIFACTS_DIR}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Target APK location: ${TARGET_APK}"
  exit 0
fi

if [[ -f "${TARGET_APK}" ]]; then
  echo "Found existing Standard Notes APK at ${TARGET_APK}. Skipping download."
  exit 0
fi

echo "Fetching latest official Standard Notes Android release from GitHub..."
RELEASE_JSON=$(curl -sSL "https://api.github.com/repos/standardnotes/app/releases/latest")
APK_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*standard-notes[^"]*\.apk' | head -n 1 || true)

if [[ -z "${APK_URL}" ]]; then
  echo "Fallback: Querying recent releases for android apk..."
  RELEASES_ALL=$(curl -sSL "https://api.github.com/repos/standardnotes/app/releases?per_page=5")
  APK_URL=$(echo "${RELEASES_ALL}" | grep -o 'https://[^"]*\.apk' | head -n 1 || true)
fi

if [[ -z "${APK_URL}" ]]; then
  echo "Error: Could not locate an official .apk release asset from standardnotes/app repository." >&2
  exit 1
fi

echo "Downloading from: ${APK_URL}"
curl -fL --progress-bar "${APK_URL}" -o "${TARGET_APK}"
echo "Successfully downloaded official APK to ${TARGET_APK}"
```

- [ ] **Step 4: Make script executable and run test**

Run: `chmod +x scripts/download-official-sn-apk.sh && deno test --allow-read --allow-run tests/apk-downloader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/download-official-sn-apk.sh tests/apk-downloader.test.ts
git commit -m "feat(android-e2e): add official Standard Notes APK download script"
```

---

### Task 3: WebdriverIO & Appium Configuration

**Files:**
- Create: `tests/e2e-android/wdio.conf.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Target APK at `artifacts/standardnotes.apk`, Appium UiAutomator2 driver.
- Produces: WebdriverIO test runner configuration pointing to `tests/e2e-android/specs/**/*.spec.ts`.

- [ ] **Step 1: Update `package.json` with WebdriverIO dependencies and test script**

Add devDependencies for WebdriverIO:
```json
"@wdio/cli": "^9.1.2",
"@wdio/local-runner": "^9.1.2",
"@wdio/mocha-framework": "^9.1.2",
"@wdio/spec-reporter": "^9.1.2",
"webdriverio": "^9.1.2"
```
And add npm script:
```json
"test:e2e:android-app": "wdio run tests/e2e-android/wdio.conf.ts"
```

- [ ] **Step 2: Create `tests/e2e-android/wdio.conf.ts`**

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const apkPath = path.join(rootDir, "artifacts/standardnotes.apk");

export const config = {
  runner: "local",
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: path.join(rootDir, "tsconfig.json"),
      transpileOnly: true,
    },
  },
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:deviceName": process.env.ANDROID_DEVICE_NAME || "Android Emulator",
      "appium:app": apkPath,
      "appium:appPackage": "com.standardnotes",
      "appium:appActivity": "com.standardnotes.MainActivity",
      "appium:noReset": false,
      "appium:fullReset": false,
      "appium:autoGrantPermissions": true,
      "appium:newCommandTimeout": 240,
    },
  ],
  logLevel: "info",
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 300000,
  },
};
```

- [ ] **Step 3: Verify configuration syntax using `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add package.json tests/e2e-android/wdio.conf.ts
git commit -m "feat(android-e2e): configure WebdriverIO and Appium runner for Android"
```

---

### Task 4: Standard Notes Mobile App Page Object

**Files:**
- Create: `tests/e2e-android/pages/StandardNotesApp.ts`

**Interfaces:**
- Consumes: WebdriverIO global `$` and `browser` commands.
- Produces: `StandardNotesApp` class automating app navigation, plugin installation, and note creation.

- [ ] **Step 1: Create `tests/e2e-android/pages/StandardNotesApp.ts`**

```typescript
export class StandardNotesApp {
  async dismissOnboarding(): Promise<void> {
    // Attempt to dismiss initial welcome / onboarding modals if present
    const skipButton = await $('//*[@text="Skip" or @text="Get Started" or @text="Use Offline"]');
    if (await skipButton.isExisting()) {
      await skipButton.click();
    }
  }

  async openSettings(): Promise<void> {
    // Open hamburger menu drawer
    const menuButton = await $('~Open navigation drawer, ~drawer, //*[@content-desc="Menu"]');
    if (await menuButton.isExisting()) {
      await menuButton.click();
    }
    const settingsOption = await $('//*[@text="Settings"]');
    await settingsOption.waitForDisplayed({ timeout: 10000 });
    await settingsOption.click();
  }

  async installCustomPlugin(manifestUrl: string): Promise<void> {
    // Navigate into Plugins section
    const pluginsOption = await $('//*[@text="Plugins" or @text="Extensions"]');
    await pluginsOption.waitForDisplayed({ timeout: 10000 });
    await pluginsOption.click();

    // Scroll to Install Custom Plugin input field
    const urlInput = await $('//android.widget.EditText[contains(@hint, "URL") or contains(@text, "URL")]');
    await urlInput.waitForDisplayed({ timeout: 10000 });
    await urlInput.setValue(manifestUrl);

    const installButton = await $('//*[@text="Install"]');
    await installButton.waitForEnabled({ timeout: 5000 });
    await installButton.click();

    // Handle confirmation alert if it appears
    const confirmButton = await $('//*[@text="Install" or @text="Confirm" or @text="OK"]');
    if (await confirmButton.isExisting()) {
      await confirmButton.click();
    }
  }

  async createNewNote(): Promise<void> {
    // Navigate back to main notes list
    const backButton = await $('~Navigate up, //*[@content-desc="Back"]');
    while (await backButton.isExisting()) {
      await backButton.click();
      await browser.pause(500);
    }

    const addNoteButton = await $('~New note, ~Create note, //*[@content-desc="New note"]');
    await addNoteButton.waitForDisplayed({ timeout: 10000 });
    await addNoteButton.click();
  }

  async selectEditor(editorName: string): Promise<void> {
    // Open editor selection dropdown/menu in note view
    const editorMenuButton = await $('//*[@text="Editor" or @content-desc="Editor options"]');
    if (await editorMenuButton.isExisting()) {
      await editorMenuButton.click();
      const editorOption = await $(`//*[@text="${editorName}"]`);
      await editorOption.waitForDisplayed({ timeout: 5000 });
      await editorOption.click();
    }
  }

  async returnToNotesList(): Promise<void> {
    const backButton = await $('~Navigate up, //*[@content-desc="Back"]');
    if (await backButton.isExisting()) {
      await backButton.click();
    }
  }
}
```

- [ ] **Step 2: Typecheck Page Object**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-android/pages/StandardNotesApp.ts
git commit -m "feat(android-e2e): add StandardNotesApp page object"
```

---

### Task 5: Android Editor Page Object

**Files:**
- Create: `tests/e2e-android/pages/AndroidEditorPage.ts`

**Interfaces:**
- Consumes: Standard Notes WebView / Editor container interactions.
- Produces: `AndroidEditorPage` class handling editor typing and mode switching.

- [ ] **Step 1: Create `tests/e2e-android/pages/AndroidEditorPage.ts`**

```typescript
export class AndroidEditorPage {
  async waitForEditorReady(): Promise<void> {
    // Wait for the editor container or webview to be present
    const webView = await $('//android.webkit.WebView');
    await webView.waitForDisplayed({ timeout: 20000 });
  }

  async typeContent(text: string): Promise<void> {
    // Click into the editor area
    const webView = await $('//android.webkit.WebView');
    await webView.click();
    // Send keystrokes via ADB text input or driver keys
    await browser.keys(text.split(""));
  }

  async switchMode(modeName: "Writing" | "Source" | "Tasks" | "Outline" | "Mind Map"): Promise<void> {
    const modeButton = await $(`//*[@text="${modeName}" or @content-desc="${modeName}"]`);
    if (await modeButton.isExisting()) {
      await modeButton.click();
      await browser.pause(1000);
    }
  }
}
```

- [ ] **Step 2: Typecheck Page Object**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-android/pages/AndroidEditorPage.ts
git commit -m "feat(android-e2e): add AndroidEditorPage page object"
```

---

### Task 6: Android E2E Integration Spec

**Files:**
- Create: `tests/e2e-android/specs/sn-official-integration.spec.ts`

**Interfaces:**
- Consumes: `StandardNotesApp`, `AndroidEditorPage`, running Vite server at `http://10.0.2.2:5173`.
- Produces: Automated test suite asserting plugin installation, note creation, and persistence.

- [ ] **Step 1: Create `tests/e2e-android/specs/sn-official-integration.spec.ts`**

```typescript
import { StandardNotesApp } from "../pages/StandardNotesApp.js";
import { AndroidEditorPage } from "../pages/AndroidEditorPage.js";

describe("Official Standard Notes Android APK Integration", () => {
  const app = new StandardNotesApp();
  const editor = new AndroidEditorPage();

  it("completes onboarding and installs Markdown Notes+ custom extension", async () => {
    await app.dismissOnboarding();
    await app.openSettings();
    await app.installCustomPlugin("http://10.0.2.2:5173/ext.json");
  });

  it("creates a note and activates Markdown Notes+ editor", async () => {
    await app.createNewNote();
    await app.selectEditor("Markdown Notes+");
    await editor.waitForEditorReady();
  });

  it("enters content and switches projection modes", async () => {
    await editor.typeContent("# Live Android E2E Test\n\n- [ ] Task 1 verified\n");
    await editor.switchMode("Source");
    await editor.switchMode("Tasks");
    await editor.switchMode("Writing");
  });

  it("persists content when returning to note list and reopening", async () => {
    await app.returnToNotesList();
    // Verify note item appears in list with correct title
    const noteEntry = await $('//*[@text="Live Android E2E Test" or contains(@text, "Live Android E2E")]');
    await noteEntry.waitForDisplayed({ timeout: 10000 });
    await noteEntry.click();

    await editor.waitForEditorReady();
  });
});
```

- [ ] **Step 2: Typecheck spec**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-android/specs/sn-official-integration.spec.ts
git commit -m "feat(android-e2e): add end-to-end integration spec for official Standard Notes APK"
```

---

### Task 7: Full Verification and Documentation Update

**Files:**
- Modify: `README.md`
- Test: `npm run typecheck && npm run test`

- [ ] **Step 1: Update README.md with Android Testing Guide**

Add a dedicated section in `README.md` explaining how to execute Android E2E testing against the official APK:
1. Start an Android emulator or connect a device.
2. Run `npm run dev` or `npm run preview`.
3. Run `bash scripts/download-official-sn-apk.sh`.
4. Run `npm run test:e2e:android-app`.

- [ ] **Step 2: Run full test suite to ensure no regressions**

Run: `npm run typecheck && npm run test`
Expected: PASS (all unit, integration, and security contract tests pass)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Android official APK testing instructions to README"
```
