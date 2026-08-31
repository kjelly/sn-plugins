/// <reference lib="deno.ns" />

import { StandardNotesComponentTransport } from "../src/standardnotes/StandardNotesComponentTransport.ts";
import type { EditorKitDelegate } from "../src/standardnotes/EditorKitBridge.ts";

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

type FakeElement = {
  id: string;
  href: string;
  type: string;
  rel: string;
  media: string;
  className: string;
  remove: () => void;
};

function fakeWindow(): {
  window: Window;
  outbound: Array<{ payload: unknown; origin: string }>;
  dispatch: (data: unknown, origin?: string) => void;
  elements: FakeElement[];
} {
  const listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  const outbound: Array<{ payload: unknown; origin: string }> = [];
  const elements: FakeElement[] = [];
  const addListener = (type: string, listener: (event: MessageEvent) => void) => {
    const existing = listeners.get(type) ?? [];
    existing.push(listener);
    listeners.set(type, existing);
  };
  const removeListener = (type: string, listener: (event: MessageEvent) => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  };
  const fakeDocument = {
    referrer: "",
    documentElement: { classList: { add: (_className: string) => undefined } },
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => addListener(`document:${type}`, listener),
    removeEventListener: (type: string, listener: (event: MessageEvent) => void) => removeListener(`document:${type}`, listener),
    createElement: () => {
      const element: FakeElement = {
        id: "",
        href: "",
        type: "",
        rel: "",
        media: "",
        className: "",
        remove: () => {
          const index = elements.indexOf(element);
          if (index >= 0) elements.splice(index, 1);
        },
      };
      return element;
    },
    getElementsByTagName: () => [{ appendChild: (element: FakeElement) => elements.push(element) }],
    getElementById: (id: string) => elements.find((element) => element.id === id),
  };
  const fake = {
    document: fakeDocument,
    parent: { postMessage: (payload: unknown, origin: string) => outbound.push({ payload, origin }) },
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => addListener(type, listener),
    removeEventListener: (type: string, listener: (event: MessageEvent) => void) => removeListener(type, listener),
  } as unknown as Window;
  return {
    window: fake,
    outbound,
    elements,
    dispatch(data, origin = "https://host.example") {
      for (const listener of listeners.get("message") ?? []) listener({ data, origin } as MessageEvent);
    },
  };
}

const options = { mode: "markdown" as const, coallesedSaving: false, coallesedSavingDelay: 300 };

Deno.test("Component transport accepts JSON inbound messages and correlates replies", async () => {
  const fake = fakeWindow();
  const rawTexts: string[] = [];
  const notes: unknown[] = [];
  let undoClears = 0;
  const delegate: EditorKitDelegate = {
    setEditorRawText: (text) => rawTexts.push(text),
    handleRequestForContentHeight: () => 321,
    onNoteValueChange: async (note) => { notes.push(note); },
    clearUndoHistory: () => { undoClears += 1; },
  };
  const transport = new StandardNotesComponentTransport(delegate, options, fake.window);

  fake.dispatch(JSON.stringify({
    action: "component-registered",
    sessionKey: "mobile-session",
    componentData: {},
    data: { environment: "mobile", platform: "mobile", uuid: "editor", activeThemeUrls: [] },
  }));

  assertEquals(fake.outbound.length, 2, "registration should flush context request and announce themes");
  const contextRequest = fake.outbound[0].payload as Record<string, unknown>;
  assertEquals(typeof contextRequest, "object");
  assertEquals(contextRequest.action, "stream-context-item");
  assertEquals(contextRequest.sessionKey, "mobile-session");
  assertEquals(contextRequest.api, "component");
  assertEquals(fake.outbound[0].origin, "https://host.example");

  fake.dispatch(JSON.stringify({
    action: "reply",
    original: { messageId: contextRequest.messageId },
    data: { item: { uuid: "note-1", content: { text: "# Initial" } } },
  }));
  await Promise.resolve();
  assertEquals(rawTexts, ["# Initial"]);
  assertEquals(notes.length, 1);
  assertEquals(undoClears, 1);

  const note = notes[0] as { uuid: string; content: { text: string } };
  note.content.text = "# Saved";
  transport.saveItemWithPresave(note, () => { note.content.text = "# Presaved"; });
  const save = fake.outbound[fake.outbound.length - 1].payload as Record<string, unknown>;
  assertEquals(save.action, "save-items");
  assertEquals(typeof save, "object");
  assertEquals((save.data as { items: Array<{ content: { text: string } }> }).items[0].content.text, "# Presaved");
  assertEquals(save.sessionKey, "mobile-session");
  assertEquals((save.data as { height: number }).height, 321);
});
