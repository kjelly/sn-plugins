declare const $: (selector: string) => Promise<{
  click(): Promise<void>;
  isExisting(): Promise<boolean>;
  waitForDisplayed(opts?: { timeout?: number }): Promise<void>;
  waitForEnabled(opts?: { timeout?: number }): Promise<void>;
  setValue(value: string): Promise<void>;
  getText(): Promise<string>;
}>;

declare const browser: {
  pause(ms: number): Promise<void>;
  keys(keys: string[] | string): Promise<void>;
};

export class StandardNotesApp {
  async dismissOnboarding(): Promise<void> {
    const skipButton = await $('//*[@text="Skip" or @text="Get Started" or @text="Use Offline"]');
    if (await skipButton.isExisting()) {
      await skipButton.click();
    }
  }

  async openSettings(): Promise<void> {
    const menuButton = await $('~Open navigation drawer, ~drawer, //*[@content-desc="Menu"]');
    if (await menuButton.isExisting()) {
      await menuButton.click();
    }
    const settingsOption = await $('//*[@text="Settings"]');
    await settingsOption.waitForDisplayed({ timeout: 10000 });
    await settingsOption.click();
  }

  async installCustomPlugin(manifestUrl: string): Promise<void> {
    const pluginsOption = await $('//*[@text="Plugins" or @text="Extensions"]');
    await pluginsOption.waitForDisplayed({ timeout: 10000 });
    await pluginsOption.click();

    const urlInput = await $('//android.widget.EditText[contains(@hint, "URL") or contains(@text, "URL")]');
    await urlInput.waitForDisplayed({ timeout: 10000 });
    await urlInput.setValue(manifestUrl);

    const installButton = await $('//*[@text="Install"]');
    await installButton.waitForEnabled({ timeout: 5000 });
    await installButton.click();

    const confirmButton = await $('//*[@text="Install" or @text="Confirm" or @text="OK"]');
    if (await confirmButton.isExisting()) {
      await confirmButton.click();
    }
  }

  async createNewNote(): Promise<void> {
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
