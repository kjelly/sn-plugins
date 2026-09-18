import { CanonicalDocument } from "../document/CanonicalDocument.ts";
import { EditorKitBridge } from "./EditorKitBridge.ts";
import { createEditorKit } from "./EditorKitRuntime.ts";

type RuntimeListener = () => void;

export type EditorRuntime = {
  canonical: CanonicalDocument;
  bridge: EditorKitBridge;
  subscribeHostChange: (listener: RuntimeListener) => () => void;
  subscribeWritingHistoryReset: (listener: RuntimeListener) => () => void;
};

export type EditorRuntimeOptions = {
  onPreview: (text: string, locked: boolean) => void;
};

/**
 * The bridge runtime is deliberately React-free. It can register the one-shot
 * Standard Notes listener before the editor UI and its dependencies download.
 */
export function createEditorRuntime({ onPreview }: EditorRuntimeOptions): EditorRuntime {
  const canonical = new CanonicalDocument();
  const hostListeners = new Set<RuntimeListener>();
  const writingHistoryListeners = new Set<RuntimeListener>();
  const bridge = new EditorKitBridge(
    canonical,
    () => {
      onPreview(canonical.text, canonical.locked);
      for (const listener of hostListeners) listener();
    },
    createEditorKit,
    undefined,
    () => {
      for (const listener of writingHistoryListeners) listener();
    },
  );

  return {
    canonical,
    bridge,
    subscribeHostChange(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
    subscribeWritingHistoryReset(listener) {
      writingHistoryListeners.add(listener);
      return () => writingHistoryListeners.delete(listener);
    },
  };
}

/** Preserve the deterministic mobile harness while starting production eagerly. */
export function startEditorRuntime(runtime: EditorRuntime): void {
  const params = new URLSearchParams(globalThis.location.search);
  const mobileProtocolTest = params.get("sn-mobile-protocol") === "1";
  const manualStart = mobileProtocolTest && params.get("sn-bridge-start") === "manual";
  const readyDelayMs = Math.max(0, Number(params.get("sn-bridge-ready-delay-ms") ?? "0") || 0);

  const announceReady = () => {
    if (mobileProtocolTest) document.documentElement.dataset.snBridgeReady = "true";
  };
  const start = () => {
    runtime.bridge.start();
    if (manualStart) globalThis.parent.postMessage({ type: "sn-bridge-started" }, "*");
    if (readyDelayMs === 0) announceReady();
    else globalThis.setTimeout(announceReady, readyDelayMs);
  };

  if (!manualStart) {
    start();
    return;
  }

  const startOnRequest = (event: MessageEvent) => {
    if (event.source !== globalThis.parent || event.data?.type !== "sn-start-bridge") return;
    globalThis.removeEventListener("message", startOnRequest);
    start();
  };
  globalThis.addEventListener("message", startOnRequest);
  globalThis.parent.postMessage({ type: "sn-bridge-start-pending" }, "*");
}
