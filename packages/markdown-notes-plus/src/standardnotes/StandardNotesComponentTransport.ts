import type { EditorKitDelegate } from "./EditorKitBridge.ts";

type MessageData = Record<string, unknown>;
type MessageAction =
  | "component-registered"
  | "themes"
  | "reply"
  | "themes-activated"
  | "stream-context-item"
  | "save-items"
  | "set-component-data"
  | "set-size"
  | "key-down"
  | "key-up"
  | "click";

type ComponentMessage = {
  action?: MessageAction;
  data?: unknown;
  componentData?: Record<string, unknown>;
  messageId?: string;
  sessionKey?: string;
  api?: "component";
  original?: { messageId?: string };
};

type RegistrationData = {
  environment?: string;
  platform?: string;
  uuid?: string;
  activeThemeUrls?: unknown;
};

type TransportNote = {
  uuid?: string;
  content?: { text?: unknown; appData?: unknown; [key: string]: unknown };
  children?: unknown;
  parent?: unknown;
  [key: string]: unknown;
};

type QueuedMessage = {
  action: MessageAction;
  data: MessageData;
  callback?: (data: unknown) => void;
};

type SentMessage = QueuedMessage & { messageId: string };

export type StandardNotesComponentTransportOptions = {
  mode: "markdown";
  coallesedSaving: boolean;
  coallesedSavingDelay: number;
};

/**
 * The editor-owned subset of Standard Notes' Component API.
 *
 * This intentionally mirrors the pinned EditorKit/ComponentRelay protocol at
 * the boundary, but keeps the outbound payload as a structured object. The
 * host ComponentManager consumes event.data as an object on every platform.
 */
export class StandardNotesComponentTransport {
  private readonly targetWindow: Window;
  private readonly options: StandardNotesComponentTransportOptions;
  private readonly component: {
    activeThemes: string[];
    acceptsThemes: boolean;
    origin?: string;
    sessionKey?: string;
    data?: Record<string, unknown>;
    environment?: string;
    platform?: string;
    uuid?: string;
  } = { activeThemes: [], acceptsThemes: true };
  private readonly messageQueue: QueuedMessage[] = [];
  private readonly sentMessages: SentMessage[] = [];
  private lastStreamedItem?: TransportNote;
  private messageIdCounter = 0;
  private note?: TransportNote;
  private readonly messageHandler: (event: MessageEvent) => void;
  private readonly keyDownEventListener: (event: KeyboardEvent) => void;
  private readonly keyUpEventListener: (event: KeyboardEvent) => void;
  private readonly clickEventListener: () => void;

  constructor(
    private readonly delegate: EditorKitDelegate,
    options: StandardNotesComponentTransportOptions,
    targetWindow?: Window,
  ) {
    if (targetWindow) this.targetWindow = targetWindow;
    else {
      if (typeof window === "undefined") throw new Error("Component transport requires a window.");
      this.targetWindow = window;
    }
    this.options = options;

    this.messageHandler = (event) => this.handleIncomingEvent(event);
    this.keyDownEventListener = (event) => {
      if (event.ctrlKey) this.postMessage("key-down", { keyboardModifier: "Control" });
      else if (event.shiftKey) this.postMessage("key-down", { keyboardModifier: "Shift" });
      else if (event.metaKey || event.key === "Meta") this.postMessage("key-down", { keyboardModifier: "Meta" });
    };
    this.keyUpEventListener = (event) => {
      if (event.key === "Control") this.postMessage("key-up", { keyboardModifier: "Control" });
      else if (event.key === "Shift") this.postMessage("key-up", { keyboardModifier: "Shift" });
      else if (event.key === "Meta") this.postMessage("key-up", { keyboardModifier: "Meta" });
    };
    this.clickEventListener = () => this.postMessage("click", {});

    this.targetWindow.document.addEventListener("message", this.messageHandler as EventListener, false);
    this.targetWindow.addEventListener("message", this.messageHandler, false);
    this.targetWindow.addEventListener("keydown", this.keyDownEventListener, false);
    this.targetWindow.addEventListener("keyup", this.keyUpEventListener, false);
    this.targetWindow.addEventListener("click", this.clickEventListener, false);

    // The initial request is queued until the host supplies the session key.
    this.streamContextItem((data) => this.handleContextItem(data));
  }

  deinit(): void {
    this.targetWindow.document.removeEventListener("message", this.messageHandler as EventListener, false);
    this.targetWindow.removeEventListener("message", this.messageHandler, false);
    this.targetWindow.removeEventListener("keydown", this.keyDownEventListener, false);
    this.targetWindow.removeEventListener("keyup", this.keyUpEventListener, false);
    this.targetWindow.removeEventListener("click", this.clickEventListener, false);
    this.messageQueue.length = 0;
    this.sentMessages.length = 0;
  }

  get platform(): string | undefined { return this.component.platform; }
  get environment(): string | undefined { return this.component.environment; }

  isRunningInMobileApplication(): boolean {
    return this.component.environment === "mobile";
  }

  getComponentDataValueForKey(key: string): unknown {
    return this.component.data?.[key];
  }

  setComponentDataValueForKey(key: string, value: unknown): void {
    if (!this.component.data) throw new Error("The component has not been initialized.");
    if (!key) throw new Error("The key for the data value should be a valid string.");
    this.component.data = { ...this.component.data, [key]: value };
    this.postMessage("set-component-data", { componentData: this.component.data });
  }

  getItemAppDataValue(item: TransportNote | undefined, key: string): unknown {
    const appData = item?.content?.appData;
    if (!appData || typeof appData !== "object") return undefined;
    const standardNotesData = (appData as Record<string, unknown>)["org.standardnotes.sn"];
    if (!standardNotesData || typeof standardNotesData !== "object") return undefined;
    return (standardNotesData as Record<string, unknown>)[key];
  }

  setSize(width: string | number, height: string | number): void {
    this.postMessage("set-size", { type: "container", width, height });
  }

  saveItemWithPresave(note: TransportNote, presave?: () => void, callback?: () => void): void {
    // Presave must run before the item is cloned into the outbound payload.
    presave?.();
    const item = this.jsonObjectForItem(note);
    this.postMessage("save-items", { items: [item] }, callback ? () => callback() : undefined);
  }

  onEditorValueChanged(text: string): void {
    if (!this.note) return;
    this.saveItemWithPresave(this.note, () => {
      if (!this.note?.content) this.note = { ...this.note, content: {} };
      this.note.content!.text = text;
      this.note.content!.preview_plain = text;
      this.note.content!.preview_html = undefined;
    });
  }

  private streamContextItem(callback: (data: unknown) => void): void {
    this.postMessage("stream-context-item", {}, callback);
  }

  private jsonObjectForItem(item: TransportNote): Record<string, unknown> {
    return { ...item, children: null, parent: null };
  }

  private handleContextItem(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const note = (data as { item?: unknown }).item;
    if (!note || typeof note !== "object") return;
    const nextNote = note as TransportNote;
    const isNewNoteLoad = !this.lastStreamedItem || this.lastStreamedItem.uuid !== nextNote.uuid;
    const previousNote = this.lastStreamedItem;
    this.lastStreamedItem = nextNote;
    this.note = nextNote;

    if (nextNote.isMetadataUpdate === true) return;

    const text = typeof nextNote.content?.text === "string" ? nextNote.content.text : "";
    void this.deliverNote(nextNote, previousNote, text, isNewNoteLoad);
  }

  private async deliverNote(
    note: TransportNote,
    previousNote: TransportNote | undefined,
    text: string,
    isNewNoteLoad: boolean,
  ): Promise<void> {
    await this.delegate.onNoteValueChange?.(note);
    this.delegate.setEditorRawText(text);

    if (this.delegate.onNoteLockToggle) {
      const previousLockState = this.getItemAppDataValue(previousNote, "locked") ?? false;
      const newLockState = this.getItemAppDataValue(note, "locked") ?? false;
      if (previousLockState !== newLockState) this.delegate.onNoteLockToggle(newLockState === true);
    }

    if (isNewNoteLoad) this.delegate.clearUndoHistory?.();
  }

  private handleIncomingEvent(event: MessageEvent): void {
    if (!this.isAllowedOrigin(event.origin)) return;
    const payload = this.parseMessage(event.data);
    if (!payload) return;

    if (this.component.origin === undefined && payload.action === "component-registered") {
      this.component.origin = event.origin;
    } else if (event.origin !== this.component.origin) {
      return;
    }

    if (payload.action === "component-registered") {
      this.handleRegistration(payload);
      return;
    }
    if (payload.action === "themes") {
      const data = payload.data;
      const themes = data && typeof data === "object" && Array.isArray((data as { themes?: unknown }).themes)
        ? (data as { themes: unknown[] }).themes.filter((theme): theme is string => typeof theme === "string")
        : [];
      this.activateThemes(themes);
      return;
    }

    const messageId = payload.original?.messageId;
    if (!messageId) return;
    const original = this.sentMessages.find((message) => message.messageId === messageId);
    original?.callback?.(payload.data);
  }

  private handleRegistration(payload: ComponentMessage): void {
    this.component.sessionKey = payload.sessionKey;
    if (payload.componentData) this.component.data = payload.componentData;
    const data = payload.data && typeof payload.data === "object" ? payload.data as RegistrationData : {};
    this.component.environment = data.environment;
    this.component.platform = data.platform;
    this.component.uuid = data.uuid;
    if (data.platform) this.targetWindow.document.documentElement.classList.add(data.platform);

    const queued = this.messageQueue.splice(0);
    for (const message of queued) this.postMessage(message.action, message.data, message.callback);

    const activeThemeUrls = Array.isArray(data.activeThemeUrls)
      ? data.activeThemeUrls.filter((url): url is string => typeof url === "string")
      : [];
    this.activateThemes(activeThemeUrls);
    this.postMessage("themes-activated", {});
  }

  private activateThemes(incomingUrls: string[]): void {
    if (!this.component.acceptsThemes) return;
    if (this.component.activeThemes.join("\n") === incomingUrls.join("\n")) return;

    for (const url of this.component.activeThemes) {
      if (!incomingUrls.includes(url)) this.deactivateTheme(url);
    }
    this.component.activeThemes = [...incomingUrls];

    for (const url of incomingUrls) {
      if (this.targetWindow.document.getElementById(this.themeElementId(url))) continue;
      const link = this.targetWindow.document.createElement("link");
      link.id = this.themeElementId(url);
      link.href = url;
      link.type = "text/css";
      link.rel = "stylesheet";
      link.media = "screen,print";
      link.className = "custom-theme";
      this.targetWindow.document.getElementsByTagName("head")[0]?.appendChild(link);
    }
    this.delegate.onThemesChange?.();
  }

  private deactivateTheme(url: string): void {
    this.targetWindow.document.getElementById(this.themeElementId(url))?.remove();
  }

  private themeElementId(url: string): string {
    try {
      return btoa(url);
    } catch {
      return `sn-theme-${encodeURIComponent(url)}`;
    }
  }

  private postMessage(action: MessageAction, data: MessageData, callback?: (data: unknown) => void): void {
    if (!this.component.sessionKey) {
      this.messageQueue.push({ action, data, callback });
      return;
    }

    const messageId = this.generateMessageId();
    const payload: ComponentMessage & { action: MessageAction; data: MessageData; messageId: string; sessionKey: string; api: "component" } = {
      action,
      data: action === "save-items"
        ? { ...data, height: this.delegate.handleRequestForContentHeight() }
        : data,
      messageId,
      sessionKey: this.component.sessionKey,
      api: "component",
    };
    this.sentMessages.push({ action, data: payload.data as MessageData, callback, messageId });
    const targetOrigin = this.component.origin && this.component.origin !== "null" ? this.component.origin : "*";
    this.targetWindow.parent.postMessage(payload, targetOrigin);
  }

  private generateMessageId(): string {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
    this.messageIdCounter += 1;
    return `sn-editor-message-${Date.now()}-${this.messageIdCounter}`;
  }

  private parseMessage(data: unknown): ComponentMessage | undefined {
    let parsed = data;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return undefined;
      }
    }
    if (!parsed || Object.prototype.toString.call(parsed) !== "[object Object]") return undefined;
    return parsed as ComponentMessage;
  }

  private isAllowedOrigin(origin: string): boolean {
    const referrer = this.targetWindow.document.referrer;
    if (!referrer) return true;
    try {
      return new URL(referrer).origin === new URL(origin).origin;
    } catch {
      return referrer === origin;
    }
  }
}
