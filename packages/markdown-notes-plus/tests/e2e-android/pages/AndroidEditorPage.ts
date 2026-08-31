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
  private async editorInput() {
    // The component WebView exposes Milkdown's contenteditable surface as an
    // Android EditText. Clicking only the WebView container leaves focus on
    // the iframe/root, so native key events never reach the editor document.
    return await $('(//android.widget.EditText)[last()]');
  }

  private async componentWebView() {
    // Standard Notes itself owns the outer WebView; an iframe component is
    // exposed as a second, nested WebView by Appium. The last WebView is the
    // editor surface and is the only one whose text reflects this plugin.
    return await $('(//android.webkit.WebView)[last()]');
  }

  async waitForEditorReady(): Promise<void> {
    const webView = await this.componentWebView();
    const nativePlainEditor = await $('//*[@resource-id="note-text-editor"]');
    const deadline = Date.now() + 20000;
    while (Date.now() <= deadline) {
      if (
        await webView.isExisting()
        && !(await nativePlainEditor.isExisting())
      ) {
        await webView.waitForDisplayed({ timeout: Math.max(1, deadline - Date.now()) });
        return;
      }
      await browser.pause(Math.min(500, Math.max(1, deadline - Date.now())));
    }
    throw new Error("Custom editor WebView did not replace the native plain editor");
  }

  async typeContent(text: string): Promise<void> {
    const input = await this.editorInput();
    await input.waitForDisplayed({ timeout: 10000 });
    await input.click();
    await browser.keys(text.split(""));
  }

  async readVisibleText(): Promise<string> {
    const webView = await this.componentWebView();
    return await webView.getText();
  }

  async waitForVisibleText(expectedText: string, timeoutMs = 15000): Promise<string> {
    const webView = await this.componentWebView();
    await webView.waitForDisplayed({ timeout: timeoutMs });

    const deadline = Date.now() + timeoutMs;
    let lastVisibleText = "";
    let lastReadError: unknown;
    while (Date.now() <= deadline) {
      try {
        lastVisibleText = await webView.getText();
        if (lastVisibleText.includes(expectedText)) {
          return lastVisibleText;
        }
      } catch (error) {
        // The native WebView can be temporarily unavailable while its UI is
        // recreated. Preserve the error for the final diagnostic.
        lastReadError = error;
      }

      await browser.pause(Math.min(500, Math.max(1, deadline - Date.now())));
    }

    const errorDetail = lastReadError instanceof Error ? ` Last read error: ${lastReadError.message}` : "";
    throw new Error(
      `Expected visible editor text to contain ${JSON.stringify(expectedText)}; `
      + `last observed text was ${JSON.stringify(lastVisibleText)}.${errorDetail}`,
    );
  }

  async switchMode(modeName: "Writing" | "Source" | "Tasks" | "Outline" | "Mind Map"): Promise<void> {
    const modeButton = await $(`//*[@text="${modeName}" or @content-desc="${modeName}"]`);
    if (await modeButton.isExisting()) {
      await modeButton.click();
      await browser.pause(1000);
    }
  }
}
