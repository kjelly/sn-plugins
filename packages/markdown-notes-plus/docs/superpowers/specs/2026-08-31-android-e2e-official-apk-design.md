# Design Specification: Android E2E Testing with Official Standard Notes APK

- **Date**: 2026-08-31
- **Target Package**: `@local/markdown-notes-plus`
- **Host Application**: Standard Notes Android Official Release APK (`com.standardnotes`)

---

## 1. Overview & Objectives

This specification outlines the architecture, automation toolchain, and test flow for running end-to-end integration tests of `markdown-notes-plus` inside the **official release APK of Standard Notes on Android** without requiring custom compilation of the React Native app.

### Goals
1. Validate that `markdown-notes-plus` can be installed into the official Standard Notes Android app via custom extension URL (`ext.json`).
2. Verify bidirectional communication protocol (Mobile JSON string `postMessage` protocol) in the real production Android WebView container.
3. Validate editor initialization, text input, projection mode switching (Writing, Source, Tasks, Outline, Mind Map), and data persistence across note reopen cycles in the official app.
4. Provide an automated, repeatable test script via WebdriverIO and Appium UiAutomator2.

---

## 2. System Architecture & Topology

```
+-----------------------------------------------------------------------------------+
| Host Development Machine (Linux / CI)                                             |
|                                                                                   |
|  +---------------------------+       +-----------------------------------------+  |
|  | WebdriverIO Test Runner   | ----> | Appium Server 2.x (UiAutomator2)        |  |
|  | (sn-official-integration) |       | (:4723)                                 |  |
|  +---------------------------+       +-----------------------------------------+  |
|               |                                           |                       |
|               | (HTTP Localhost)                          | (ADB Commands)        |
|               v                                           v                       |
|  +---------------------------+               +---------------------------------+  |
|  | Vite Web Server (:5173)   |               | Android Emulator / Device       |  |
|  | - /ext.json (Manifest)    | <=========== | - Standard Notes APK            |  |
|  | - /index.html (Editor)    | (HTTP 10.0.2.2)| - CustomAndroidWebView Container| |
|  +---------------------------+               +---------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Network Resolution Strategy
- **Android Emulator**: Uses `http://10.0.2.2:5173` to access the host machine's Vite server.
- **Physical Device**: Uses `adb reverse tcp:5173 tcp:5173` allowing the app on device to access `http://127.0.0.1:5173`.

---

## 3. Extension Manifest (`public/ext.json`)

To allow Standard Notes Android to register and load the editor:

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

---

## 4. Automation Toolchain

1. **Test Runner**: WebdriverIO (`@wdio/cli`, `@wdio/mocha-framework`, `@wdio/local-runner`, `@wdio/appium-service`).
2. **Appium Driver**: `@appium/uiautomator2-driver` for native Android automation.
3. **Artifact Fetching**: `scripts/download-official-sn-apk.sh` fetching the latest APK asset from GitHub release (`https://github.com/standardnotes/app/releases`).

---

## 5. End-to-End Test Execution Flow

### Step 1: Pre-test Environment Setup
1. Download official Standard Notes APK (if not already cached locally in `artifacts/`).
2. Verify ADB connectivity to active emulator or physical device.
3. Install APK using `adb install -r artifacts/standardnotes.apk`.
4. Start local Vite preview/dev server on port `5173`.

### Step 2: App Launch & Initial Onboarding
1. Launch app package `com.standardnotes` (`MainActivity`).
2. Dismiss onboarding / welcome screens (e.g. skip account login or proceed to local offline mode).

### Step 3: Custom Extension Installation
1. Open sidebar navigation drawer.
2. Tap **Settings** -> **Plugins**.
3. Scroll to **Install Custom Plugin**.
4. Type `http://10.0.2.2:5173/ext.json` into the input field and tap **Install**.
5. Confirm installation dialog.

### Step 4: Create Note & Activate Editor
1. Return to the main notes list.
2. Tap **New Note** (`+` action button).
3. Tap the Editor selector in the note options menu.
4. Select **Markdown Notes+**.
5. Wait for iframe handshake and editor toolbar mount.

### Step 5: Functional & Persistence Verification
1. Tap into the writing editor and enter test markdown content (`# E2E Test on Android\n- [ ] Android Verification`).
2. Switch projection modes:
   - **Source Mode**: Verify raw markdown synchronization.
   - **Tasks Mode**: Verify task item extraction.
   - **Outline Mode**: Verify heading tree extraction.
3. Navigate back to note list (triggering Standard Notes local database autosave).
4. Re-open the note:
   - Assert note title/preview displays `# E2E Test on Android`.
   - Assert editor content is restored without data corruption.

---

## 6. Page Objects Design

1. **`StandardNotesApp.ts`**:
   - `dismissOnboarding()`
   - `openSettings()`
   - `installCustomPlugin(manifestUrl: string)`
   - `createNewNote()`
   - `selectEditor(editorName: string)`
   - `navigateBackToList()`
   - `openNoteWithTitle(title: string)`

2. **`AndroidEditorPage.ts`**:
   - `waitForEditorReady()`
   - `typeMarkdown(text: string)`
   - `switchMode(modeName: string)`
   - `getEditorText()`

---

## 7. Error Handling & Edge Cases

1. **Android Keyboard Interference**: Use `driver.hideKeyboard()` before attempting UI clicks on bottom navigation buttons.
2. **WebView Context Switching vs Native Accessibility Fallback**: Since production APK may disable Chromium remote debugging flags, tests primarily use UiAutomator2 native accessibility nodes with fallback to ADB input events (`adb shell input text`).
3. **Onboarding Idempotency**: If the app is already configured in local storage, onboarding dismissal handles both fresh install and existing session states.
4. **Network Timeout & Retry**: Extension manifest download has a 10-second timeout with automated retry in case Vite server initialization takes a moment.

---

## 8. Directory & File Plan

```
packages/markdown-notes-plus/
├── public/
│   └── ext.json
├── scripts/
│   └── download-official-sn-apk.sh
├── tests/
│   └── e2e-android/
│       ├── wdio.conf.ts
│       ├── pages/
│       │   ├── StandardNotesApp.ts
│       │   └── AndroidEditorPage.ts
│       └── specs/
│           └── sn-official-integration.spec.ts
└── package.json (add "test:e2e:android-app")
```
