import type { EditorKitDelegate } from "./EditorKitBridge";

type Note = {
  uuid?: string;
  isMetadataUpdate?: boolean;
  content?: { text?: unknown; appData?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
};

type Message = {
  action: string;
  data?: unknown;
  messageId?: string;
  sessionKey?: string;
  original?: { messageId?: string };
};

type MessageCallback = (data: unknown) => void;

type RelayOptions = {
  targetWindow?: Window;
  onReady?: (data: Record<string, unknown>) => void;
  onThemesChange?: () => void;
};

const COMPONENT_API = "component";
const ACTIONS = {
  componentRegistered: "component-registered",
  streamContextItem: "stream-context-item",
  saveItems: "save-items",
  activateThemes: "themes",
  themesActivated: "themes-activated",
  reply: "reply",
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMessage(value: unknown): Message | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!isObject(value) || typeof value.action !== "string") return undefined;
  return value as Message;
}

function uuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sn-editor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The Android 3.202.1 ComponentManager expects an object at event.data, while
 * the upstream ComponentRelay serializes mobile messages before postMessage.
 * This small adapter keeps the upstream message schema but sends the payload
 * as an object for the affected Android host.
 */
export class AndroidCompatibleComponentRelay {
  private readonly targetWindow: Window;
  private readonly onReady?: (data: Record<string, unknown>) => void;
  private readonly onThemesChange?: () => void;
  private readonly callbacks = new Map<string, MessageCallback>();
  private readonly queued: Array<{ action: string; data: unknown; callback?: MessageCallback }> = [];
  private readonly handledEvents = new WeakSet<MessageEvent>();
  private readonly activeThemeUrls: string[] = [];
  private sessionKey?: string;
  private origin?: string;
  private messageHandler?: (event: MessageEvent) => void;

  constructor(options: RelayOptions = {}) {
    this.targetWindow = options.targetWindow ?? window;
    this.onReady = options.onReady;
    this.onThemesChange = options.onThemesChange;
    this.messageHandler = (event: MessageEvent) => this.handleMessageEvent(event);

    this.targetWindow.addEventListener("message", this.messageHandler);
    this.targetWindow.document?.addEventListener("message", this.messageHandler as EventListener);
  }

  private handleMessageEvent(event: MessageEvent): void {
    if (this.handledEvents.has(event)) return;
    this.handledEvents.add(event);

    const message = parseMessage(event.data);
    if (!message) return;

    if (this.sessionKey === undefined && message.action === ACTIONS.componentRegistered) {
      this.sessionKey = typeof message.sessionKey === "string" ? message.sessionKey : undefined;
      this.origin = event.origin;
      if (!this.sessionKey) return;

      const data = isObject(message.data) ? message.data : {};
      this.flushQueue();
      this.onReady?.(data);
      return;
    }

    if (this.origin !== undefined && event.origin !== this.origin && event.origin !== "") return;

    if (message.action === ACTIONS.activateThemes) {
      const data = isObject(message.data) ? message.data : {};
      this.activateThemes(Array.isArray(data.themes) ? data.themes.filter((url): url is string => typeof url === "string") : []);
      return;
    }

    const messageId = message.original?.messageId;
    if (!messageId) return;
    const callback = this.callbacks.get(messageId);
    if (!callback) return;
    this.callbacks.delete(messageId);
    callback(message.data);
  }

  private flushQueue(): void {
    const queued = this.queued.splice(0);
    for (const entry of queued) this.postMessage(entry.action, entry.data, entry.callback);
  }

  private postMessage(action: string, data: unknown, callback?: MessageCallback): void {
    if (!this.sessionKey) {
      this.queued.push({ action, data, callback });
      return;
    }

    const message: Message & { api: string } = {
      action,
      data,
      messageId: uuid(),
      sessionKey: this.sessionKey,
      api: COMPONENT_API,
    };
    if (callback && message.messageId) this.callbacks.set(message.messageId, callback);

    // Do not JSON.stringify here. This is the compatibility boundary for the
    // direct-property ComponentManager shipped in Standard Notes 3.202.1.
    this.targetWindow.parent.postMessage(message, "*");
  }

  streamContextItem(callback: (note: Note) => void | Promise<void>): void {
    this.postMessage(ACTIONS.streamContextItem, {}, (data) => {
      const item = isObject(data) && isObject(data.item) ? data.item as Note : undefined;
      if (item) void callback(item);
    });
  }

  saveItemWithPresave(note: Note, presave?: () => void): void {
    presave?.();
    const item = { ...note, children: null, parent: null };
    this.postMessage(ACTIONS.saveItems, { items: [item] });
  }

  private activateThemes(urls: string[]): void {
    const next = urls.slice();
    if (next.sort().join(";") === this.activeThemeUrls.slice().sort().join(";")) return;

    for (const existing of this.activeThemeUrls.splice(0)) {
      const element = this.targetWindow.document.getElementById(btoa(existing));
      element?.remove();
    }
    for (const url of next) {
      const link = this.targetWindow.document.createElement("link");
      link.id = btoa(url);
      link.href = url;
      link.rel = "stylesheet";
      link.type = "text/css";
      this.targetWindow.document.head.appendChild(link);
      this.activeThemeUrls.push(url);
    }
    this.onThemesChange?.();
  }

  sendThemesActivated(): void {
    this.postMessage(ACTIONS.themesActivated, {});
  }

  deinit(): void {
    if (!this.messageHandler) return;
    this.targetWindow.removeEventListener("message", this.messageHandler);
    this.targetWindow.document?.removeEventListener("message", this.messageHandler as EventListener);
    this.messageHandler = undefined;
    this.callbacks.clear();
    this.queued.length = 0;
  }
}

export class AndroidCompatibleEditorKit {
  private readonly relay: AndroidCompatibleComponentRelay;
  private note?: Note;

  constructor(private readonly delegate: EditorKitDelegate, _options: {
    mode: "markdown";
    coallesedSaving: boolean;
    coallesedSavingDelay: number;
  }) {
    this.relay = new AndroidCompatibleComponentRelay({
      onReady: (data) => {
        const platform = typeof data.platform === "string" ? data.platform : undefined;
        if (platform) document.documentElement.classList.add(platform);
        this.relay.sendThemesActivated();
      },
      onThemesChange: delegate.onThemesChange,
    });
    this.relay.streamContextItem(async (note) => {
      const previous = this.note;
      this.note = note;
      const isNewNote = previous === undefined || previous.uuid !== note.uuid;

      const previousLocked = this.locked(previous);
      const nextLocked = this.locked(note);

      // Standard Notes may deliver Prevent Editing changes as metadata-only
      // context updates. The lock state above must be handled even when there
      // is no new text to render.
      if (note.isMetadataUpdate === true) {
        if (previousLocked !== nextLocked) delegate.onNoteLockToggle?.(nextLocked);
        return;
      }

      const text = typeof note.content?.text === "string" ? note.content.text : "";
      await delegate.onNoteValueChange?.(note);
      delegate.setEditorRawText(text);
      if (previousLocked !== nextLocked) delegate.onNoteLockToggle?.(nextLocked);
      if (isNewNote) delegate.clearUndoHistory?.();
    });
  }

  private locked(note?: Note): boolean {
    const appData = note?.content?.appData;
    const standardNotesData = appData?.["org.standardnotes.sn"];
    return isObject(standardNotesData) && standardNotesData.locked === true;
  }

  saveItemWithPresave(note: Note, presave?: () => void): void {
    this.relay.saveItemWithPresave(note, presave);
  }

  deinit(): void {
    this.relay.deinit();
  }
}
