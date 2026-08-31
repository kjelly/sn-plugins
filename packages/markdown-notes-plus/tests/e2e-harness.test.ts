function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/// <reference lib="deno.ns" />

import {
  DEFAULT_ANDROID_BUILD_TOOLS_VERSION,
  resolveAndroidBuildToolsVersion,
  resolveAppiumEndpoint,
} from "./e2e-android/appium-endpoint.ts";
import {
  assertEditorSelectionVerified,
  assertPluginInstallationVerified,
  createPrerequisiteGate,
  findFirstExistingElement,
  getHierarchyRootPackage,
  handleNotificationPermission,
  hasNonEmptyInteractiveSurface,
  isStandardNotesHierarchy,
  isStandardNotesForeground,
  NAVIGATION_MENU_SELECTORS,
  STANDARD_NOTES_ACTIVITY,
  STANDARD_NOTES_PACKAGE,
  waitForStandardNotesUiReady,
} from "./e2e-android/pages/android-harness.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  makeTempDir(options?: { prefix?: string }): Promise<string>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  Command: new (
    command: string,
    options?: {
      args?: string[];
      env?: Record<string, string>;
      stdout?: "piped" | "inherit";
      stderr?: "piped" | "inherit";
    },
  ) => {
    output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
  };
};

Deno.test("WDIO endpoint resolver maps default and custom Appium ports", () => {
  assertEquals(resolveAppiumEndpoint(), {
    protocol: "http",
    hostname: "127.0.0.1",
    port: 4723,
    path: "/",
  });
  assertEquals(resolveAppiumEndpoint("4729"), {
    protocol: "http",
    hostname: "127.0.0.1",
    port: 4729,
    path: "/",
  });
});

Deno.test("WDIO Android toolchain resolver maps default and custom Build Tools versions", () => {
  assertEquals(resolveAndroidBuildToolsVersion(), DEFAULT_ANDROID_BUILD_TOOLS_VERSION);
  assertEquals(resolveAndroidBuildToolsVersion("34.0.0"), "34.0.0");
});

Deno.test("Android navigation readiness uses the observed semantic menu selector", () => {
  assertEquals(NAVIGATION_MENU_SELECTORS, [
    '//*[@text="Open navigation menu"]',
    "~Open navigation menu",
  ]);
});

Deno.test("Android selector fallback queries each candidate separately", async () => {
  const requestedSelectors: string[] = [];
  const selected = await findFirstExistingElement((selector) => {
    requestedSelectors.push(selector);
    return Promise.resolve({
      click: async () => await Promise.resolve(),
      isExisting: async () => await Promise.resolve(selector === "~drawer"),
    });
  }, ["~Open navigation drawer", "~drawer", '//*[@content-desc="Menu"]']);

  assertEquals(requestedSelectors, ["~Open navigation drawer", "~drawer"]);
  assertEquals(selected !== undefined, true);
  assertEquals(requestedSelectors.some((selector) => selector.includes(",")), false);
});

Deno.test("notification permission handling clicks Allow only when its dialog is present", async () => {
  const requestedSelectors: string[] = [];
  let clicked = false;
  const handled = await handleNotificationPermission((selector) => {
    requestedSelectors.push(selector);
    return Promise.resolve({
      click: async () => await Promise.resolve().then(() => {
        clicked = true;
      }),
      isExisting: async () => await Promise.resolve(
        (selector.includes("Standard Notes") && selector.includes("notifications"))
          || selector === "~Allow",
      ),
    });
  });

  assertEquals(handled, true);
  assertEquals(clicked, true);
  assertEquals(requestedSelectors.some((selector) => selector.includes(",")), false);
});

Deno.test("notification permission handling semantically allows a permission-controller prompt", async () => {
  let clicked = false;
  const handled = await handleNotificationPermission(
    (selector) => Promise.resolve({
      click: async () => await Promise.resolve().then(() => {
        clicked = true;
      }),
      isExisting: async () => await Promise.resolve(selector === "~Allow"),
    }),
    {
      getCurrentPackage: async () => await Promise.resolve("com.android.permissioncontroller"),
      getCurrentActivity: async () => await Promise.resolve("GrantPermissionsActivity"),
      pause: async () => await Promise.resolve(),
    },
  );

  assertEquals(handled, true);
  assertEquals(clicked, true);
});

Deno.test("non-empty Standard Notes readiness rejects an empty hierarchy", () => {
  assertEquals(hasNonEmptyInteractiveSurface("<hierarchy />"), false);
  assertEquals(
    hasNonEmptyInteractiveSurface(
      '<hierarchy><android.widget.Button content-desc="Open navigation menu" clickable="true" /></hierarchy>',
    ),
    true,
  );
});

Deno.test("hierarchy readiness identifies the visible root package", () => {
  const standardNotesHierarchy =
    '<hierarchy rotation="0"><android.widget.FrameLayout package="com.standardnotes">'
    + '<android.widget.TextView package="android" text="Underlying content" />'
    + "</android.widget.FrameLayout></hierarchy>";
  const androidOverlayHierarchy =
    '<hierarchy rotation="0"><android.widget.FrameLayout package="android">'
    + '<android.widget.TextView text="System UI isn\'t responding" />'
    + "</android.widget.FrameLayout></hierarchy>";

  assertEquals(getHierarchyRootPackage(standardNotesHierarchy), STANDARD_NOTES_PACKAGE);
  assertEquals(isStandardNotesHierarchy(standardNotesHierarchy), true);
  assertEquals(getHierarchyRootPackage(androidOverlayHierarchy), "android");
  assertEquals(isStandardNotesHierarchy(androidOverlayHierarchy), false);
});

Deno.test("Standard Notes readiness waits for a non-empty surface and semantic navigation menu", async () => {
  const pageSources = [
    "<hierarchy />",
    `<hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" package="${STANDARD_NOTES_PACKAGE}"><android.widget.Button content-desc="Open navigation menu" clickable="true" /></android.widget.FrameLayout></hierarchy>`,
  ];
  let sourceIndex = 0;
  let pageSourceReads = 0;
  let currentPageSource = "";
  const selectorLookups: Array<{ selector: string; pageSourceReads: number; pageSource: string }> = [];
  const menu = {
    click: async () => await Promise.resolve(),
    isExisting: async () => await Promise.resolve(currentPageSource === pageSources[1]),
  };

  const selected = await waitForStandardNotesUiReady(
    {
      getCurrentPackage: async () => await Promise.resolve(STANDARD_NOTES_PACKAGE),
      getCurrentActivity: async () => await Promise.resolve(STANDARD_NOTES_ACTIVITY),
      getPageSource: async () => {
        pageSourceReads += 1;
        currentPageSource = pageSources[Math.min(sourceIndex++, pageSources.length - 1)];
        return await Promise.resolve(currentPageSource);
      },
      takeScreenshot: async () => await Promise.resolve("screenshot"),
      getLogs: async () => await Promise.resolve(""),
      pause: async () => await Promise.resolve(),
    },
    (selector) => {
      selectorLookups.push({ selector, pageSourceReads, pageSource: currentPageSource });
      return Promise.resolve(menu);
    },
    NAVIGATION_MENU_SELECTORS,
    1000,
  );

  assertEquals(selected, menu);
  assertEquals(pageSourceReads >= 2, true);
  assertEquals(selectorLookups.length >= 1, true);
  assertEquals(selectorLookups.some(({ pageSource }) => pageSource === pageSources[0]), false);
  assertEquals(selectorLookups[0], {
    selector: '//*[@text="Open navigation menu"]',
    pageSourceReads: 2,
    pageSource: pageSources[1],
  });
});

Deno.test("default Standard Notes readiness requires the semantic navigation menu", async () => {
  const pageSource =
    `<hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" package="${STANDARD_NOTES_PACKAGE}">`
    + '<android.widget.Button content-desc="Open navigation menu" clickable="true" />'
    + "</android.widget.FrameLayout></hierarchy>";
  let lookupCalls = 0;
  const menu = {
    click: async () => await Promise.resolve(),
    isExisting: async () => await Promise.resolve(true),
  };

  const selected = await waitForStandardNotesUiReady(
    {
      getCurrentPackage: async () => await Promise.resolve(STANDARD_NOTES_PACKAGE),
      getCurrentActivity: async () => await Promise.resolve(STANDARD_NOTES_ACTIVITY),
      getPageSource: async () => await Promise.resolve(pageSource),
      takeScreenshot: async () => await Promise.resolve("encoded-image"),
      getLogs: async () => await Promise.resolve(""),
      pause: () => Promise.reject(new Error("readiness should succeed without waiting")),
    },
    (selector) => Promise.resolve().then(() => {
      lookupCalls += 1;
      assertEquals(selector, '//*[@text="Open navigation menu"]');
      return menu;
    }),
  );

  assertEquals(selected, menu);
  assertEquals(lookupCalls, 1);
});

Deno.test("StandardNotesApp readiness does not query selectors before the Standard Notes gate", async () => {
  const source = await Deno.readTextFile("tests/e2e-android/pages/StandardNotesApp.ts");
  const readinessMethodStart = source.indexOf("private async ensureStandardNotesUiReady()");
  const readinessMethodEnd = source.indexOf("\n  }", readinessMethodStart);
  const readinessMethod = source.slice(readinessMethodStart, readinessMethodEnd);

  assertEquals(readinessMethod.includes("handleNotificationPermission"), false);
  assertEquals(readinessMethod.includes("await waitForStandardNotesUiReady(browser, $);"), true);
});

Deno.test("StandardNotesApp public actions query selectors only after UI readiness", async () => {
  const events: string[] = [];
  const pageSource =
    `<hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" package="${STANDARD_NOTES_PACKAGE}">`
    + '<android.widget.Button content-desc="Open navigation menu" clickable="true" />'
    + "</android.widget.FrameLayout></hierarchy>";
  const menuButton = {
    click: () => Promise.resolve().then(() => {
      events.push("menu-click");
    }),
    isExisting: () => Promise.resolve(true),
  };
  const settingsOption = {
    click: () => Promise.resolve().then(() => {
      events.push("settings-click");
    }),
    isExisting: () => Promise.resolve(true),
    isDisplayed: () => Promise.resolve(true),
    waitForDisplayed: () => Promise.resolve().then(() => {
      events.push("settings-wait");
    }),
  };
  const lookup = (selector: string) => Promise.resolve().then(() => {
    events.push(`selector:${selector}`);
    if (selector === '//*[@text="Open navigation menu"]') {
      return menuButton;
    }
    if (selector === '//*[@text="Settings"]') {
      return settingsOption;
    }
    throw new Error(`Unexpected selector lookup: ${selector}`);
  });
  const driver = {
    getCurrentPackage: () => Promise.resolve().then(() => {
      events.push("getCurrentPackage");
      return STANDARD_NOTES_PACKAGE;
    }),
    getCurrentActivity: () => Promise.resolve().then(() => {
      events.push("getCurrentActivity");
      return STANDARD_NOTES_ACTIVITY;
    }),
    getPageSource: () => Promise.resolve().then(() => {
      events.push("getPageSource");
      events.push("valid-standard-notes-readiness");
      return pageSource;
    }),
    takeScreenshot: () => Promise.resolve("encoded-image"),
    getLogs: () => Promise.resolve(""),
    pause: () => Promise.reject(new Error("readiness should succeed without waiting")),
  };
  const globalValues = globalThis as Record<string, unknown>;
  const hadDollar = Object.prototype.hasOwnProperty.call(globalValues, "$");
  const hadBrowser = Object.prototype.hasOwnProperty.call(globalValues, "browser");
  const previousDollar = globalValues.$;
  const previousBrowser = globalValues.browser;
  globalValues.$ = lookup;
  globalValues.browser = driver;

  try {
    const { StandardNotesApp } = await import("./e2e-android/pages/StandardNotesApp.ts?readiness-ordering");
    await new StandardNotesApp().openSettings();
  } finally {
    if (hadDollar) {
      globalValues.$ = previousDollar;
    } else {
      delete globalValues.$;
    }
    if (hadBrowser) {
      globalValues.browser = previousBrowser;
    } else {
      delete globalValues.browser;
    }
  }

  const readinessIndex = events.indexOf("valid-standard-notes-readiness");
  const selectorIndices = events
    .map((event, index) => event.startsWith("selector:") ? index : -1)
    .filter((index) => index >= 0);
  const menuClickIndex = events.indexOf("menu-click");
  const settingsWaitIndex = events.indexOf("settings-wait");
  const settingsClickIndex = events.indexOf("settings-click");

  assertEquals(readinessIndex >= 0, true, events.join(", "));
  assertEquals(selectorIndices.length >= 2, true, events.join(", "));
  assertEquals(selectorIndices.every((index) => index > readinessIndex), true, events.join(", "));
  assertEquals(menuClickIndex > readinessIndex, true, events.join(", "));
  assertEquals(settingsWaitIndex > readinessIndex, true, events.join(", "));
  assertEquals(settingsClickIndex > readinessIndex, true, events.join(", "));
  assertEquals(settingsClickIndex > menuClickIndex, true, events.join(", "));
});

Deno.test("readiness timeout rejects non-empty permission-controller and ANR hierarchies", async () => {
  const blockedHierarchies = [
    {
      packageName: "com.google.android.permissioncontroller",
      activityName: "com.android.permissioncontroller.permission.ui.GrantPermissionsActivity",
      pageSource:
        '<hierarchy><android.widget.FrameLayout package="com.google.android.permissioncontroller">'
        + '<android.widget.TextView text="Allow Standard Notes to send you notifications?" />'
        + '<android.widget.Button text="Allow" clickable="true" />'
        + "</android.widget.FrameLayout></hierarchy>",
      expectedText: "Allow Standard Notes to send you notifications?",
      logs: "Permission controller is waiting for notification approval",
    },
    {
      packageName: "android",
      activityName: "com.android.server.am.AppNotRespondingDialog",
      pageSource:
        '<hierarchy><android.widget.FrameLayout package="android">'
        + '<android.widget.TextView text="Application Not Responding" />'
        + '<android.widget.Button text="Wait" clickable="true" />'
        + '<android.widget.Button text="Close app" clickable="true" />'
        + "</android.widget.FrameLayout></hierarchy>",
      expectedText: "Application Not Responding",
      logs: "Input dispatching timed out (ANR)",
    },
  ];

  for (const { packageName, activityName, pageSource, expectedText, logs } of blockedHierarchies) {
    let readinessLoops = 0;
    const requestedSelectors: string[] = [];
    let error = "";
    try {
      await waitForStandardNotesUiReady(
        {
          getCurrentPackage: async () => await Promise.resolve(packageName),
          getCurrentActivity: async () => await Promise.resolve(activityName),
          getPageSource: async () => await Promise.resolve(pageSource),
          takeScreenshot: async () => await Promise.resolve("encoded-image"),
          getLogs: async () => await Promise.resolve(logs),
          pause: async () => await Promise.resolve().then(() => {
            readinessLoops += 1;
          }),
        },
        (selector) => {
          requestedSelectors.push(selector);
          return Promise.resolve({
            click: async () => await Promise.resolve(),
            isExisting: async () => await Promise.resolve(false),
          });
        },
        NAVIGATION_MENU_SELECTORS,
        25,
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    assertEquals(error.includes("readiness timed out"), true, error);
    assertEquals(error.includes(`Focus: ${packageName}/${activityName}`), true, error);
    assertEquals(error.includes("Hierarchy:"), true);
    assertEquals(error.includes(expectedText), true);
    assertEquals(error.includes("Screenshot (base64): encoded-image"), true);
    assertEquals(error.includes(`ANR/logcat: ${logs}`), true);
    assertEquals(readinessLoops >= 1, true);
    assertEquals(requestedSelectors, []);
  }
});

Deno.test("readiness rejects a System UI ANR despite stale Standard Notes foreground focus", async () => {
  const pageSource =
    '<hierarchy rotation="0"><android.widget.FrameLayout package="android">'
    + '<android.widget.TextView text="System UI isn\'t responding" />'
    + '<android.widget.Button text="Close app" clickable="true" />'
    + '<android.widget.Button text="Wait" clickable="true" />'
    + "</android.widget.FrameLayout></hierarchy>";
  let readinessPolls = 0;
  let selectorLookups = 0;
  let error = "";

  try {
    await waitForStandardNotesUiReady(
      {
        getCurrentPackage: async () => await Promise.resolve(STANDARD_NOTES_PACKAGE),
        getCurrentActivity: async () => await Promise.resolve(".MainActivity"),
        getPageSource: async () => await Promise.resolve(pageSource),
        takeScreenshot: async () => await Promise.resolve("encoded-image"),
        getLogs: async () => await Promise.resolve("Input dispatching timed out (ANR)"),
        pause: async () => await Promise.resolve().then(() => {
          readinessPolls += 1;
        }),
      },
      () => {
        selectorLookups += 1;
        throw new Error("overlay must be rejected before selector lookup");
      },
      NAVIGATION_MENU_SELECTORS,
      25,
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  assertEquals(error.includes("readiness timed out"), true, error);
  assertEquals(error.includes('package="android"'), true, error);
  assertEquals(error.includes("System UI isn't responding"), true, error);
  assertEquals(error.includes("Focus: com.standardnotes/.MainActivity"), true, error);
  assertEquals(readinessPolls > 0, true);
  assertEquals(selectorLookups, 0);
});

Deno.test("navigation readiness times out for a non-empty Standard Notes hierarchy without its semantic menu", async () => {
  const pageSource =
    `<hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" package="${STANDARD_NOTES_PACKAGE}">`
    + '<android.widget.TextView text="Notes" />'
    + '<android.widget.Button content-desc="Create note" clickable="true" />'
    + "</android.widget.FrameLayout></hierarchy>";
  const requestedSelectors: string[] = [];
  let error = "";
  try {
    await waitForStandardNotesUiReady(
      {
        getCurrentPackage: async () => await Promise.resolve(STANDARD_NOTES_PACKAGE),
        getCurrentActivity: async () => await Promise.resolve(STANDARD_NOTES_ACTIVITY),
        getPageSource: async () => await Promise.resolve(pageSource),
        takeScreenshot: async () => await Promise.resolve("encoded-image"),
        getLogs: async () => await Promise.resolve(""),
        pause: async () => await Promise.resolve(),
      },
      (selector) => {
        requestedSelectors.push(selector);
        return Promise.resolve({
          click: async () => await Promise.resolve(),
          isExisting: async () => await Promise.resolve(false),
        });
      },
      NAVIGATION_MENU_SELECTORS,
      50,
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  assertEquals(error.includes("readiness timed out"), true, error);
  assertEquals(hasNonEmptyInteractiveSurface(pageSource), true);
  assertEquals(requestedSelectors.length >= 1, true);
  assertEquals(
    requestedSelectors.every((selector) => selector === '//*[@text="Open navigation menu"]' || selector === "~Open navigation menu"),
    true,
  );
});

Deno.test("foreground readiness requires the Standard Notes package and MainActivity", () => {
  assertEquals(isStandardNotesForeground(STANDARD_NOTES_PACKAGE, STANDARD_NOTES_ACTIVITY), true);
  assertEquals(isStandardNotesForeground(STANDARD_NOTES_PACKAGE, ".MainActivity"), true);
  assertEquals(isStandardNotesForeground("com.google.android.permissioncontroller", "GrantPermissionsActivity"), false);
});

/*
 Deno.test("foreground readiness waits through the permission controller and then succeeds", async () => {
  const foregroundStates = [
    ["com.google.android.permissioncontroller", "GrantPermissionsActivity"],
    [STANDARD_NOTES_PACKAGE, ".MainActivity"],
  ];
  let index = 0;
  await waitForStandardNotesForeground({
    getCurrentPackage: async () => await Promise.resolve(
      foregroundStates[Math.min(index, foregroundStates.length - 1)][0],
    ),
    getCurrentActivity: async () => await Promise.resolve(
      foregroundStates[Math.min(index++, foregroundStates.length - 1)][1],
    ),
    pause: async () => await Promise.resolve(),
  });
  assertEquals(index >= 2, true);
});
*/

Deno.test("prerequisite gate blocks dependent work until setup completes", () => {
  const gate = createPrerequisiteGate("Android setup");
  let blocked = false;
  try {
    gate.assertReady();
  } catch {
    blocked = true;
  }
  assertEquals(blocked, true);
  assertEquals(gate.isReady(), false);

  gate.markReady();
  gate.assertReady();
  assertEquals(gate.isReady(), true);
});

Deno.test("plugin installation verification fails when the plugin is absent", () => {
  let error = "";
  try {
    assertPluginInstallationVerified("Markdown Notes+", false);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  assertEquals(error.includes("Markdown Notes+"), true);
});

Deno.test("editor selection verification fails when the editor menu is absent", () => {
  let error = "";
  try {
    assertEditorSelectionVerified("Markdown Notes+", {
      editorMenuVisible: false,
      editorOptionVisible: false,
      activeEditorVisible: false,
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  assertEquals(error.includes("editor menu"), true);
});

Deno.test("editor selection verification fails when the option or active editor is absent", () => {
  let missingOptionError = "";
  try {
    assertEditorSelectionVerified("Markdown Notes+", {
      editorMenuVisible: true,
      editorOptionVisible: false,
      activeEditorVisible: false,
    });
  } catch (caught) {
    missingOptionError = caught instanceof Error ? caught.message : String(caught);
  }

  let missingActiveEditorError = "";
  try {
    assertEditorSelectionVerified("Markdown Notes+", {
      editorMenuVisible: true,
      editorOptionVisible: true,
      activeEditorVisible: false,
    });
  } catch (caught) {
    missingActiveEditorError = caught instanceof Error ? caught.message : String(caught);
  }

  assertEquals(missingOptionError.includes("editor option"), true);
  assertEquals(missingActiveEditorError.includes("active and visible"), true);
});

Deno.test("headless runner cleanup targets only the validated emulator PID", async () => {
  const script = await Deno.readTextFile("scripts/run-headless-e2e.sh");
  const cleanupStart = script.indexOf("cleanup() {");
  const cleanupEnd = script.indexOf("trap cleanup EXIT", cleanupStart);
  const cleanup = script.slice(cleanupStart, cleanupEnd);

  assertEquals(cleanup.includes('process_is_expected "${EMULATOR_PID}" "${EMULATOR_START_TIME}" "emulator"'), true, cleanup);
  assertEquals(cleanup.includes('kill "${EMULATOR_PID}" 2>/dev/null || true'), true, cleanup);
  assertEquals(cleanup.includes("adb emu kill"), false, cleanup);
});

Deno.test("headless runner pre-grants and verifies notifications before Appium can launch the app", async () => {
  const script = await Deno.readTextFile("scripts/run-headless-e2e.sh");
  const installIndex = script.indexOf('adb install -r "${APK_PATH}"');
  const permissionIndex = script.indexOf("establish_notification_permission", installIndex);
  const appiumLaunchIndex = script.indexOf('"${ROOT_DIR}/node_modules/.bin/appium"', permissionIndex);

  assertEquals(script.includes('NOTIFICATION_PERMISSION="android.permission.POST_NOTIFICATIONS"'), true);
  assertEquals(script.includes('adb shell pm grant "${STANDARD_NOTES_PACKAGE}" "${NOTIFICATION_PERMISSION}"'), true);
  assertEquals(script.includes('grep -Eq "${NOTIFICATION_PERMISSION}: granted=true"'), true);
  assertEquals(permissionIndex > installIndex, true);
  assertEquals(appiumLaunchIndex > permissionIndex, true);
});

async function runNotificationPermissionVerifier(adbScript: string) {
  const fixtureDir = await Deno.makeTempDir({ prefix: "markdown-notes-plus-permission-" });
  const adbPath = `${fixtureDir}/adb`;
  const verifierPath = `${fixtureDir}/verify-permission.sh`;
  const runner = await Deno.readTextFile("scripts/run-headless-e2e.sh");
  const functionStart = runner.indexOf("establish_notification_permission() {");
  const functionEnd = runner.indexOf("\n}\n\ncollect_android_diagnostics", functionStart) + 2;

  await Deno.writeTextFile(adbPath, adbScript);
  await Deno.chmod(adbPath, 0o755);
  await Deno.writeTextFile(
    verifierPath,
    `#!/usr/bin/env bash
set -euo pipefail
STANDARD_NOTES_PACKAGE="com.standardnotes"
NOTIFICATION_PERMISSION="android.permission.POST_NOTIFICATIONS"
${runner.slice(functionStart, functionEnd)}
establish_notification_permission
`,
  );
  await Deno.chmod(verifierPath, 0o755);

  const command = new Deno.Command("bash", {
    args: [verifierPath],
    env: { PATH: `${fixtureDir}:/usr/local/bin:/usr/bin:/bin` },
    stdout: "piped",
    stderr: "piped",
  });
  return command.output();
}

Deno.test("notification permission verification consumes dumpsys output before matching", async () => {
  const result = await runNotificationPermissionVerifier(`#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"pm grant"* ]]; then
  exit 0
fi
if [[ "$*" == *"dumpsys package"* ]]; then
  printf 'android.permission.POST_NOTIFICATIONS: granted=true\\r\\n'
  for ((index = 0; index < 100000; index++)); do
    printf 'padding line %06d\\r\\n' "$index"
  done
  exit 0
fi
exit 64
`);
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  assertEquals(result.code, 0, output);
  assertEquals(output.includes("Notification permission verified before Standard Notes launch."), true, output);
});

Deno.test("notification permission verification fails when dumpsys fails", async () => {
  const result = await runNotificationPermissionVerifier(`#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"pm grant"* ]]; then
  exit 0
fi
if [[ "$*" == *"dumpsys package"* ]]; then
  exit 23
fi
exit 64
`);
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  assertEquals(result.code !== 0, true, output);
  assertEquals(output.includes("could not inspect com.standardnotes notification permission state"), true, output);
});

Deno.test("headless runner emits focus, hierarchy, screenshot, and ANR diagnostics on E2E failure", async () => {
  const script = await Deno.readTextFile("scripts/run-headless-e2e.sh");
  assertEquals(script.includes("=== Focus ==="), true);
  assertEquals(script.includes("uiautomator dump"), true);
  assertEquals(script.includes("screencap -p"), true);
  assertEquals(script.includes("ANR/logcat"), true);
});

Deno.test("headless runner fails closed when Appium Build Tools are missing", async () => {
  const androidHome = await Deno.makeTempDir({ prefix: "markdown-notes-plus-android-home-" });
  const command = new Deno.Command("bash", {
    args: ["scripts/run-headless-e2e.sh"],
    env: {
      ANDROID_HOME: androidHome,
      ANDROID_BUILD_TOOLS_VERSION: "35.0.0",
      APPIUM_PORT: "4729",
      HOME: androidHome,
      PATH: "/usr/local/bin:/usr/bin:/bin",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  assertEquals(result.code !== 0, true, output);
  assertEquals(output.includes("Android Build Tools 35.0.0 is missing the Appium signing tools"), true, output);
  assertEquals(output.includes(`${androidHome}/build-tools/35.0.0/lib/apksigner.jar`), true, output);
  assertEquals(output.includes("bash scripts/setup-headless-android.sh"), true, output);
  assertEquals(output.includes("Checking Android Device"), false, output);
  assertEquals(output.includes("Installing Standard Notes Official APK"), false, output);
});

Deno.test("headless runner fails closed when a required port is occupied", async () => {
  const fixtureDir = await Deno.makeTempDir({ prefix: "markdown-notes-plus-e2e-" });
  const fakeSs = `${fixtureDir}/ss`;
  await Deno.writeTextFile(
    fakeSs,
    `#!/usr/bin/env bash
echo "LISTEN 0 128 0.0.0.0:5173 0.0.0.0:* users:((\"fixture-owner\",pid=4242,fd=3))"
`,
  );
  await Deno.chmod(fakeSs, 0o755);

  const command = new Deno.Command("bash", {
    args: [
      "-c",
      [
        "bash scripts/run-headless-e2e.sh",
      ].join("\n"),
    ],
    env: { PATH: `${fixtureDir}:/usr/local/bin:/usr/bin:/bin` },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  assertEquals(result.code !== 0, true, output);
  assertEquals(output.includes("Port 5173 is already in use"), true, output);
  assertEquals(output.includes("refusing to reuse or terminate it"), true, output);
  assertEquals(output.includes("fixture-owner"), true, output);
});

Deno.test("headless runner rejects a self-colliding Appium port before Android work", async () => {
  const command = new Deno.Command("bash", {
    args: ["scripts/run-headless-e2e.sh"],
    env: { APPIUM_PORT: "5173", PATH: "/usr/local/bin:/usr/bin:/bin" },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  assertEquals(result.code !== 0, true, output);
  assertEquals(output.includes("Vite PORT (5173) and APPIUM_PORT (5173) must be distinct"), true, output);
  assertEquals(output.includes("Checking required ports"), false, output);
  assertEquals(output.includes("Checking Android Device"), false, output);
});
