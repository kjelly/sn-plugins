declare const $: (selector: string) => Promise<{
  click(): Promise<void>;
  isExisting(): Promise<boolean>;
  waitForDisplayed(opts?: { timeout?: number }): Promise<void>;
  getText(): Promise<string>;
}>;

declare const browser: {
  pause(ms: number): Promise<void>;
  keys(keys: string[] | string): Promise<void>;
};

export class AndroidEditorPage {
  async waitForEditorReady(): Promise<void> {
    const webView = await $('//android.webkit.WebView');
    await webView.waitForDisplayed({ timeout: 20000 });
  }

  async typeContent(text: string): Promise<void> {
    const webView = await $('//android.webkit.WebView');
    await webView.click();
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
