import {
  BACK_SELECTORS,
  NEW_NOTE_SELECTORS,
  NAVIGATION_MENU_SELECTORS,
  AndroidElement,
  assertEditorSelectionVerified,
  assertPluginInstallationVerified,
  findFirstExistingElement,
  waitForStandardNotesUiReady,
} from "./android-harness.ts";

declare const $: (selector: string) => Promise<{
  click(): Promise<void>;
  isExisting(): Promise<boolean>;
  isDisplayed(): Promise<boolean>;
  waitForDisplayed(opts?: { timeout?: number }): Promise<void>;
  waitForEnabled(opts?: { timeout?: number }): Promise<void>;
  setValue(value: string): Promise<void>;
  getText(): Promise<string>;
}>;

declare const browser: {
  getCurrentPackage(): Promise<string>;
  getCurrentActivity(): Promise<string>;
  getPageSource(): Promise<string>;
  takeScreenshot(): Promise<string>;
  getLogs(type: string): Promise<unknown>;
  getContexts(): Promise<string[]>;
  switchContext(context: string): Promise<void>;
  executeScript(script: string, args: unknown[]): Promise<unknown>;
  pause(ms: number): Promise<void>;
  keys(keys: string[] | string): Promise<void>;
};

export class StandardNotesApp {
  private async ensureStandardNotesUiReady(): Promise<void> {
    await waitForStandardNotesUiReady(browser, $);
  }

  async dismissOnboarding(): Promise<void> {
    await this.ensureStandardNotesUiReady();
    const skipButton = await $('//*[@text="Skip" or @text="Get Started" or @text="Use Offline"]');
    if (await skipButton.isExisting()) {
      await skipButton.click();
    }
  }

  async openSettings(): Promise<void> {
    await this.ensureStandardNotesUiReady();
    const menuButton = await waitForStandardNotesUiReady(browser, $, NAVIGATION_MENU_SELECTORS);
    if (!menuButton) {
      throw new Error("Could not find the Standard Notes navigation menu button");
    }
    await menuButton.click();
    const settingsOption = await findFirstExistingElement($, [
      '//*[@text="Settings"]',
      '//*[@text="Preferences"]',
      '//*[@text="Go to preferences"]',
    ]);
    if (!settingsOption) {
      throw new Error("Could not find the Standard Notes settings/preferences entry");
    }
    await settingsOption.waitForDisplayed({ timeout: 10000 });
    await settingsOption.click();
  }

  async installCustomPlugin(manifestUrl: string): Promise<void> {
    // openSettings() has already moved the app into Preferences. That route
    // intentionally has no Notes navigation-menu button, so only require the
    // Standard Notes WebView/root to be ready here.
    await waitForStandardNotesUiReady(browser, $, []);
    // Standard Notes 3.202.1 renders Preferences as a mobile menu spinner.
    // Desktop/web layouts expose Plugins as a direct navigation item, so keep
    // that path as a fallback for emulator/app variants that do the same.
    const preferencesMenu = await findFirstExistingElement($, [
      '//*[@hint="Preferences Menu"]',
      '//*[@content-desc="Preferences Menu"]',
      '//*[@text="Preferences Menu"]',
      '//*[@text="Help & feedback"]',
    ]);
    if (preferencesMenu) {
      await preferencesMenu.waitForDisplayed({ timeout: 10000 });
      await preferencesMenu.click();
      const pluginsMenuItem = await $('//*[@text="Plugins" or @text="Extensions"]');
      await pluginsMenuItem.waitForDisplayed({ timeout: 10000 });
      await pluginsMenuItem.click();
    } else {
      const pluginsOption = await $('//*[@text="Plugins" or @text="Extensions"]');
      await pluginsOption.waitForDisplayed({ timeout: 10000 });
      await pluginsOption.click();
    }

    // The React placeholder is not exposed as an Android hint by this APK;
    // the custom-plugin field is the last EditText in the Plugins pane.
    const urlInput = await $('(//android.widget.EditText)[last()]');
    for (let attempt = 0; attempt < 5 && !(await urlInput.isDisplayed()); attempt += 1) {
      // The Plugins pane is a long WebView document. Appium exposes controls
      // outside the viewport as bounds [0,0], so bring the custom-plugin
      // section into view before waiting for its input.
      await browser.executeScript("mobile: scrollGesture", [{
        left: 0,
        top: 80,
        width: 320,
        height: 520,
        direction: "down",
        percent: 0.8,
      }]);
      await browser.executeScript("mobile: swipeGesture", [{
        left: 16,
        top: 560,
        right: 304,
        bottom: 96,
        direction: "up",
        percent: 0.8,
        speed: 800,
      }]);
      await browser.pause(300);
    }
    await urlInput.waitForDisplayed({ timeout: 10000 });
    const contexts = await browser.getContexts();
    const webViewContext = contexts.find((context) => context.includes("WEBVIEW"));
    if (webViewContext) {
      await browser.switchContext(webViewContext);
      const webInput = await $('input[placeholder="Enter Plugin URL"]');
      await webInput.waitForDisplayed({ timeout: 10000 });
      await webInput.setValue(manifestUrl);
      await browser.switchContext("NATIVE_APP");
    } else {
      await urlInput.click();
      // Fall back to key events when the APK does not expose a debuggable
      // WebView context to Appium.
      await browser.keys(manifestUrl);
      await browser.keys(["TAB"]);
    }

    const installButton = await $('(//*[@text="Install"])[last()]');
    await installButton.waitForEnabled({ timeout: 5000 });
    await installButton.click();

    const confirmation = await $('//*[@text="Confirm Extension"]');
    if (await confirmation.isExisting()) {
      await confirmation.waitForDisplayed({ timeout: 5000 });
      // Gallery cards also contain disabled Install buttons. The confirmation
      // dialog is the only enabled native Install button at this point.
      const confirmButton = await $('(//android.widget.Button[@text="Install" and @enabled="true"])[last()]');
      await confirmButton.waitForDisplayed({ timeout: 5000 });
      await confirmButton.click();
    }

    const installedPlugin = await $(
      '//*[contains(@text, "Markdown Notes+") or contains(@content-desc, "Markdown Notes+")]',
    );
    const pluginVisible = await installedPlugin.isExisting() && await installedPlugin.isDisplayed();
    assertPluginInstallationVerified("Markdown Notes+", pluginVisible);
  }

  async createNewNote(): Promise<void> {
    // Preferences is rendered as an overlay route in Standard Notes 3.202.1.
    // Its underlying Notes list remains present in the WebView hierarchy, so
    // explicitly dismiss the overlay before locating the new-note action.
    await browser.executeScript("mobile: pressKey", [{ keycode: 4 }]);
    await browser.pause(1000);
    let backButton: AndroidElement | undefined = await findFirstExistingElement($, BACK_SELECTORS);
    for (let attempt = 0; attempt < 4 && backButton; attempt += 1) {
      await backButton.click();
      await browser.pause(500);
      backButton = await findFirstExistingElement($, BACK_SELECTORS);
    }
    await this.ensureStandardNotesUiReady();

    const addNoteButton = await findFirstExistingElement($, NEW_NOTE_SELECTORS);
    if (!addNoteButton) {
      throw new Error("Could not find the Standard Notes new note button");
    }
    await addNoteButton.waitForDisplayed({ timeout: 10000 });
    await addNoteButton.click();
  }

  async selectEditor(editorName: string): Promise<void> {
    await this.ensureStandardNotesUiReady();
    // On mobile 3.202.1 the note editor has focus immediately after creating
    // a note. NoteView hides the header's ChangeEditorButton while focused, so
    // the only stable entry point is Note options -> Change note type.
    const editorMenuButton = await $(
      '//*[@text="Editor" or @content-desc="Editor options" or contains(@text, "Change note type") or contains(@content-desc, "Change note type")]'
    );
    let editorMenuVisible = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await editorMenuButton.isExisting() && await editorMenuButton.isDisplayed()) {
        editorMenuVisible = true;
        break;
      }
      await browser.pause(500);
    }
    if (editorMenuVisible) {
      await editorMenuButton.click();
    } else {
      const noteOptionsButton = await $('//*[@resource-id="note-options-button" or @text="Note options menu"]');
      await noteOptionsButton.waitForDisplayed({ timeout: 10000 });
      await noteOptionsButton.click();
      const changeNoteType = await $('//*[@text="Change note type" or contains(@text, "Change note type")]');
      await changeNoteType.waitForDisplayed({ timeout: 10000 });
      await changeNoteType.click();
      editorMenuVisible = true;
    }

    const editorOption = await $(`//*[@text="${editorName}"]`);
    let editorOptionVisible = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await editorOption.isExisting() && await editorOption.isDisplayed()) {
        editorOptionVisible = true;
        break;
      }
      await browser.pause(500);
    }
    if (editorOptionVisible) {
      await editorOption.click();
    }

    // The first use of an installed editor on mobile requires an explicit
    // per-note activation confirmation. Until Continue is pressed, the
    // component WebView exists but cannot receive keyboard input.
    const activationDialog = await $('//*[@text="Activate Plugin"]');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await activationDialog.isExisting() && await activationDialog.isDisplayed()) {
        const continueButton = await $('//*[@text="Continue"]');
        await continueButton.waitForDisplayed({ timeout: 10000 });
        await continueButton.click();
        for (let dismissAttempt = 0; dismissAttempt < 20; dismissAttempt += 1) {
          if (!(await activationDialog.isExisting()) || !(await activationDialog.isDisplayed())) break;
          await browser.pause(500);
        }
        break;
      }
      // The dialog is rendered asynchronously after the component WebView is
      // mounted; do not send keyboard input until this delayed gate is gone.
      await browser.pause(500);
    }

    // The selected component's display name is not part of the mobile native
    // hierarchy after the popover closes. Its ownership boundary is visible:
    // the native plain editor is gone and the component is hosted in a WebView.
    const activeEditor = await $('//android.webkit.WebView');
    const nativePlainEditor = await $('//*[@resource-id="note-text-editor"]');
    let activeEditorVisible = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        await activeEditor.isExisting()
        && await activeEditor.isDisplayed()
        && !(await nativePlainEditor.isExisting())
      ) {
        activeEditorVisible = true;
        break;
      }
      await browser.pause(500);
    }
    assertEditorSelectionVerified(editorName, {
      editorMenuVisible,
      editorOptionVisible,
      activeEditorVisible,
    });
  }

  async returnToNotesList(): Promise<void> {
    await this.ensureStandardNotesUiReady();
    const backButton = await findFirstExistingElement($, BACK_SELECTORS);
    if (backButton) {
      await backButton.click();
    }
  }

  async openExistingNote(marker: string): Promise<void> {
    await this.ensureStandardNotesUiReady();
    const noteEntry = await $(`//*[contains(@text, "${marker}") or contains(@content-desc, "${marker}")]`);
    await noteEntry.waitForDisplayed({ timeout: 10000 });
    await noteEntry.click();
  }
}
