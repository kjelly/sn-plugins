declare const $: (selector: string) => Promise<{
  click(): Promise<void>;
  isDisplayed(): Promise<boolean>;
  isExisting(): Promise<boolean>;
  setValue(value: string): Promise<void>;
  waitForDisplayed(opts?: { timeout?: number }): Promise<void>;
}>;

declare const browser: {
  execute<Result, Args extends unknown[]>(script: (...args: Args) => Result, ...args: Args): Promise<Result>;
  getContexts(): Promise<string[]>;
  pause(ms: number): Promise<void>;
  switchContext(context: string): Promise<void>;
  switchFrame(frame: unknown): Promise<void>;
  keys(keys: string[] | string): Promise<void>;
};

const EXTENSION_IFRAME = 'iframe[src="http://10.0.2.2:5173/index.html"]';
const PROSEMIRROR_EDITOR = 'div.ProseMirror.editor[contenteditable="true"][role="textbox"]';
const EDITOR_WIDTH_MODAL = '//*[@text="Set editor width"]';
const EDITOR_MODE_TOOLBAR = '[role="toolbar"][aria-label="Editor mode"]';

type ModeButtonObservation = {
  exists: boolean;
  width: number;
  height: number;
  display: string;
  visibility: string;
  opacity: string;
  active: boolean;
};

type WritingStabilityObservation = {
  writingActive: boolean;
  writingEditable: boolean;
  writingVisible: boolean;
  sourceVisible: boolean;
  status: string;
};

export class AndroidEditorPage {
  private async assertNoHostModal(stage: string): Promise<void> {
    await browser.switchContext("NATIVE_APP");
    const widthModal = await $(EDITOR_WIDTH_MODAL);
    if (await widthModal.isExisting() && await widthModal.isDisplayed()) {
      throw new Error(`Standard Notes Set editor width modal blocked the custom editor at ${stage}`);
    }
  }

  private async enterExtensionFrame(): Promise<void> {
    await this.assertNoHostModal("before editor frame selection");

    const contexts = await browser.getContexts();
    const webViewContext = contexts.find((context) => context.includes("WEBVIEW"));
    if (!webViewContext) {
      throw new Error("Standard Notes did not expose a WebView context for the custom editor");
    }

    await browser.switchContext(webViewContext);
    // Switching contexts does not reset ChromeDriver's selected frame. The
    // previous operation may have entered this extension iframe before
    // checking a native Standard Notes modal, so normalize to the host
    // document before looking for the iframe again.
    await browser.switchFrame(null);
    const iframe = await $(EXTENSION_IFRAME);
    await iframe.waitForDisplayed({ timeout: 15000 });
    await browser.switchFrame(iframe);
  }

  private async switchToWritingEditor() {
    await this.enterExtensionFrame();
    const editor = await $(PROSEMIRROR_EDITOR);
    await editor.waitForDisplayed({ timeout: 15000 });
    return editor;
  }

  private async observeModeButton(modeName: string): Promise<ModeButtonObservation> {
    return await browser.execute((toolbarSelector, requestedMode) => {
      const toolbar = Array.from(document.querySelectorAll(toolbarSelector))
        .find((candidate) => candidate.closest("[hidden]") === null);
      const button = Array.from(toolbar?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.trim() === requestedMode);
      if (!button) {
        return {
          exists: false,
          width: 0,
          height: 0,
          display: "",
          visibility: "",
          opacity: "",
          active: false,
        };
      }

      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        exists: true,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        active: button.classList.contains("active"),
      };
    }, EDITOR_MODE_TOOLBAR, modeName);
  }

  private async editorText(): Promise<string> {
    return await browser.execute(() => {
      const editor = document.querySelector('div.ProseMirror.editor[contenteditable="true"][role="textbox"]');
      return editor?.textContent ?? "";
    });
  }

  private async observeWritingStability(): Promise<WritingStabilityObservation> {
    return await browser.execute((toolbarSelector) => {
      const toolbar = Array.from(document.querySelectorAll(toolbarSelector))
        .find((candidate) => candidate.closest("[hidden]") === null);
      const writingButton = Array.from(toolbar?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.trim() === "Writing");
      const writingPane = document.querySelector<HTMLElement>(".writing-pane");
      const sourcePane = document.querySelector<HTMLElement>(".source-pane");
      const editor = document.querySelector<HTMLElement>(
        'div.ProseMirror.editor[contenteditable="true"][role="textbox"]',
      );
      const visible = (element: HTMLElement | null) => {
        if (!element || element.closest("[hidden]")) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        writingActive: writingButton?.classList.contains("active") ?? false,
        writingEditable: editor?.getAttribute("contenteditable") === "true",
        writingVisible: visible(writingPane),
        sourceVisible: visible(sourcePane),
        status: document.querySelector(".app-toolbar:not([hidden]) .status")?.textContent?.trim() ?? "",
      };
    }, EDITOR_MODE_TOOLBAR);
  }

  async waitForEditorReady(): Promise<void> {
    await this.switchToWritingEditor();
    await this.assertNoHostModal("after editor frame selection");
  }

  async typeContent(text: string): Promise<void> {
    const editor = await this.switchToWritingEditor();
    await editor.click();
    const focused = await browser.execute(() =>
      document.activeElement?.matches('div.ProseMirror.editor[contenteditable="true"][role="textbox"]') ?? false,
    );
    if (!focused) {
      throw new Error("Custom editor ProseMirror surface did not receive DOM focus before typing");
    }

    await editor.setValue(text);
    await this.assertNoHostModal("after editor typing");
  }

  async pressSoftKeyboardEnterAndType(text: string): Promise<void> {
    const editor = await this.switchToWritingEditor();
    await editor.click();
    await browser.keys(["Enter"]);
    await browser.keys(text);
    // Exceed the editor listener/canonical settle window before asserting the
    // mode. This catches delayed Source fallback rather than only the state at
    // the instant the WebView receives the key event.
    await browser.pause(700);

    const observation = await this.observeWritingStability();
    if (
      !observation.writingActive
      || !observation.writingEditable
      || !observation.writingVisible
      || observation.sourceVisible
      || observation.status.includes("Source fallback")
    ) {
      throw new Error(`Android soft-keyboard input left Writing mode: ${JSON.stringify(observation)}`);
    }
    await this.assertNoHostModal("after Android soft-keyboard Enter and typing");
  }

  async readVisibleText(): Promise<string> {
    await this.switchToWritingEditor();
    const text = await this.editorText();
    await this.assertNoHostModal("while reading editor text");
    return text;
  }

  async waitForVisibleText(expectedText: string, timeoutMs = 15000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastVisibleText = "";

    while (Date.now() <= deadline) {
      lastVisibleText = await this.readVisibleText();
      if (lastVisibleText.includes(expectedText)) {
        return lastVisibleText;
      }
      await browser.pause(Math.min(500, Math.max(1, deadline - Date.now())));
    }

    throw new Error(
      `Expected custom editor DOM text to contain ${JSON.stringify(expectedText)}; `
      + `last observed text was ${JSON.stringify(lastVisibleText)}.`,
    );
  }

  async switchMode(modeName: "Writing" | "Source" | "Split" | "Mind Map"): Promise<void> {
    await this.enterExtensionFrame();
    const modeButton = await $(
      `//*[@role="toolbar" and @aria-label="Editor mode" and not(ancestor::*[@hidden])]//button[normalize-space(.)="${modeName}"]`,
    );
    if (!(await modeButton.isExisting())) {
      throw new Error(`Editor mode button ${JSON.stringify(modeName)} was not present in the visible mode toolbar`);
    }

    const target = await this.observeModeButton(modeName);
    const targetOpacity = Number.parseFloat(target.opacity);
    if (
      !target.exists
      || target.width <= 0
      || target.height <= 0
      || target.display === "none"
      || target.visibility === "hidden"
      || target.visibility === "collapse"
      || !Number.isFinite(targetOpacity)
      || targetOpacity <= 0
    ) {
      throw new Error(`Editor mode button ${JSON.stringify(modeName)} had no observable DOM geometry/style`);
    }

    await modeButton.click();
    const postcondition = await this.observeModeButton(modeName);
    if (!postcondition.active) {
      throw new Error(`Editor did not enter ${JSON.stringify(modeName)} mode after the mode button click`);
    }
    if (modeName === "Writing") await this.switchToWritingEditor();
    await this.assertNoHostModal(`after switching to ${modeName}`);
  }
}
