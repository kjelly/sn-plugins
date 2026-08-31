export interface AndroidElement {
  click(): Promise<void>;
  isExisting(): Promise<boolean>;
}

export interface EditorSelectionVerification {
  editorMenuVisible: boolean;
  editorOptionVisible: boolean;
  activeEditorVisible: boolean;
}

export type AndroidElementLookup<Element extends AndroidElement = AndroidElement> = (selector: string) => Promise<Element>;

export interface AndroidForegroundDriver {
  getCurrentPackage(): Promise<string>;
  getCurrentActivity(): Promise<string>;
  pause(ms: number): Promise<void>;
}

export interface AndroidReadinessDriver extends AndroidForegroundDriver {
  getPageSource(): Promise<string>;
  takeScreenshot(): Promise<string>;
  getLogs?(type: string): Promise<unknown>;
}

export const STANDARD_NOTES_PACKAGE = "com.standardnotes";
export const STANDARD_NOTES_ACTIVITY = "com.standardnotes.MainActivity";

export const NAVIGATION_MENU_SELECTORS = [
  '//*[@text="Open navigation menu"]',
  "~Open navigation menu",
] as const;

const HIERARCHY_ROOT_PACKAGE_ATTRIBUTE = /\bpackage\s*=\s*(["'])(.*?)\1/;

export const BACK_SELECTORS = [
  "~Navigate up",
  '//*[@content-desc="Back"]',
  '//*[@text="Back"]',
] as const;

export const NEW_NOTE_SELECTORS = [
  "~New note",
  "~Create note",
  '//*[@content-desc="New note"]',
  '//*[contains(@text, "Create a new note")]',
] as const;

const NOTIFICATION_PERMISSION_DIALOG_SELECTORS = [
  '//*[@text="Allow Standard Notes to send you notifications?"]',
  '//*[contains(@text, "Standard Notes") and contains(@text, "notifications")]',
] as const;

const NOTIFICATION_PERMISSION_ALLOW_SELECTORS = [
  "~Allow",
  '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
  '//*[@text="Allow"]',
] as const;

/**
 * Try each selector independently. Appium treats a comma-containing
 * accessibility-id selector as one literal value, so alternatives must not
 * be joined into a single selector.
 */
export async function findFirstExistingElement<Element extends AndroidElement>(
  lookup: AndroidElementLookup<Element>,
  selectors: readonly string[],
): Promise<Element | undefined> {
  for (const selector of selectors) {
    const element = await lookup(selector);
    if (await element.isExisting()) {
      return element;
    }
  }

  return undefined;
}

export async function handleNotificationPermission(
  lookup: AndroidElementLookup,
  driver?: AndroidForegroundDriver,
): Promise<boolean> {
  const dialog = await findFirstExistingElement(lookup, NOTIFICATION_PERMISSION_DIALOG_SELECTORS);
  let permissionControllerForeground = false;
  if (driver) {
    permissionControllerForeground = (await driver.getCurrentPackage()) === "com.android.permissioncontroller";
  }
  if (!dialog && !permissionControllerForeground) {
    return false;
  }

  const allowButton = await findFirstExistingElement(lookup, NOTIFICATION_PERMISSION_ALLOW_SELECTORS);
  if (!allowButton) {
    throw new Error("Notification permission dialog is visible but its Allow button was not found");
  }

  await allowButton.click();
  return true;
}

function normalizeActivity(packageName: string, activityName: string): string {
  if (activityName.startsWith(".")) {
    return `${packageName}${activityName}`;
  }
  return activityName;
}

export function isStandardNotesForeground(packageName: string, activityName: string): boolean {
  return packageName === STANDARD_NOTES_PACKAGE
    && normalizeActivity(packageName, activityName) === STANDARD_NOTES_ACTIVITY;
}

export function hasNonEmptyInteractiveSurface(pageSource: string): boolean {
  if (!pageSource.trim()) {
    return false;
  }

  const appiumElement = "<[A-Za-z_][\\w:.-]*\\b[^>]*";
  return new RegExp(`${appiumElement}(?:clickable|focusable)="true"`).test(pageSource)
    || new RegExp(`${appiumElement}(?:text|content-desc|resource-id)="[^"]+"`).test(pageSource);
}

/**
 * Return the package that owns the visible root node in Appium's hierarchy.
 * The hierarchy wrapper itself does not consistently carry package metadata,
 * so inspect its first visible child when necessary.
 */
export function getHierarchyRootPackage(pageSource: string): string | undefined {
  const hierarchy = pageSource.match(/<hierarchy\b[^>]*>([\s\S]*?)<\/hierarchy>/);
  if (!hierarchy) {
    return undefined;
  }

  const hierarchyTag = pageSource.match(/<hierarchy\b[^>]*>/);
  const hierarchyPackage = hierarchyTag?.[0].match(HIERARCHY_ROOT_PACKAGE_ATTRIBUTE);
  if (hierarchyPackage) {
    return hierarchyPackage[2];
  }

  const rootNode = hierarchy[1].match(/<([A-Za-z_][\w:.-]*)\b[^>]*>/);
  const rootPackage = rootNode?.[0].match(HIERARCHY_ROOT_PACKAGE_ATTRIBUTE);
  return rootPackage?.[2];
}

export function isStandardNotesHierarchy(pageSource: string): boolean {
  return getHierarchyRootPackage(pageSource) === STANDARD_NOTES_PACKAGE;
}

async function collectReadinessDiagnostics(driver: AndroidReadinessDriver): Promise<string> {
  const read = async <Value>(operation: () => Promise<Value>, fallback: Value): Promise<Value> => {
    try {
      return await operation();
    } catch {
      return fallback;
    }
  };

  const packageName = await read(() => driver.getCurrentPackage(), "unavailable");
  const activityName = await read(() => driver.getCurrentActivity(), "unavailable");
  const pageSource = await read(() => driver.getPageSource(), "unavailable");
  const screenshot = await read(() => driver.takeScreenshot(), "");
  const logs = driver.getLogs ? await read(() => driver.getLogs!("logcat"), "unavailable") : "unavailable";
  const serializedLogs = typeof logs === "string" ? logs : JSON.stringify(logs);

  return [
    `Focus: ${packageName}/${activityName}`,
    `Hierarchy: ${pageSource}`,
    `Screenshot (base64): ${screenshot || "unavailable"}`,
    `ANR/logcat: ${serializedLogs || "unavailable"}`,
  ].join("\n");
}

export async function waitForStandardNotesUiReady<Element extends AndroidElement = AndroidElement>(
  driver: AndroidReadinessDriver,
  lookup: AndroidElementLookup<Element>,
  requiredSelectors: readonly string[] = NAVIGATION_MENU_SELECTORS,
  timeoutMs = 20000,
): Promise<Element | undefined> {
  const deadline = Date.now() + timeoutMs;
  let lastPageSource = "";
  let lastPackage = "";
  let lastActivity = "";

  while (Date.now() <= deadline) {
    lastPackage = await driver.getCurrentPackage();
    lastActivity = await driver.getCurrentActivity();
    if (isStandardNotesForeground(lastPackage, lastActivity)) {
      lastPageSource = await driver.getPageSource();
      if (isStandardNotesHierarchy(lastPageSource) && hasNonEmptyInteractiveSurface(lastPageSource)) {
        if (requiredSelectors.length === 0) {
          return undefined;
        }

        const element = await findFirstExistingElement(lookup, requiredSelectors);
        if (element) {
          return element;
        }
      }
    }

    await driver.pause(Math.min(500, Math.max(1, deadline - Date.now())));
  }

  const diagnostics = await collectReadinessDiagnostics(driver);
  throw new Error(
    `Standard Notes UI readiness timed out after ${timeoutMs}ms; `
      + `last observed ${lastPackage}/${lastActivity}, hierarchy length ${lastPageSource.length}.\n${diagnostics}`,
  );
}

export interface PrerequisiteGate {
  markReady(): void;
  assertReady(): void;
  isReady(): boolean;
}

export function createPrerequisiteGate(name: string): PrerequisiteGate {
  let ready = false;

  return {
    markReady(): void {
      ready = true;
    },
    assertReady(): void {
      if (!ready) {
        throw new Error(`Prerequisite not satisfied: ${name}`);
      }
    },
    isReady(): boolean {
      return ready;
    },
  };
}

export function assertPluginInstallationVerified(pluginName: string, pluginVisible: boolean): void {
  if (!pluginVisible) {
    throw new Error(`Plugin installation was not verified: ${pluginName} was not visible in the plugin UI`);
  }
}

export function assertEditorSelectionVerified(
  editorName: string,
  verification: EditorSelectionVerification,
): void {
  if (!verification.editorMenuVisible) {
    throw new Error("Could not find the Standard Notes editor menu");
  }
  if (!verification.editorOptionVisible) {
    throw new Error(`Could not find the Standard Notes editor option: ${editorName}`);
  }
  if (!verification.activeEditorVisible) {
    throw new Error(`Selected editor is not active and visible: ${editorName}`);
  }
}
