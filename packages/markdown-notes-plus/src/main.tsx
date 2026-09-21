import "./style.css";
import { createEditorRuntime, startEditorRuntime } from "./standardnotes/EditorRuntime.ts";
import { PERF_MARKS, PERF_MEASURES } from "./performance/PerfNames.ts";
import { markAndMeasurePerf, markPerf } from "./performance/PerfTrace.ts";

const root = document.getElementById("app");
if (!root) throw new Error("Markdown Notes+ root element is missing");

let previewActive = true;
const runtime = createEditorRuntime({
  onPreview(text, locked) {
    if (!previewActive) return;
    const shell = document.createElement("section");
    shell.className = "bootstrap-preview";
    shell.setAttribute("aria-label", "Note preview while editor loads");
    const status = document.createElement("div");
    status.className = "bootstrap-preview-status";
    status.textContent = locked ? "Loading editor · read-only" : "Loading editor…";
    const content = document.createElement("pre");
    content.className = "bootstrap-preview-content";
    content.textContent = text;
    shell.append(status, content);
    root.replaceChildren(shell);
    markAndMeasurePerf(
      PERF_MARKS.bootstrapPreviewRendered,
      PERF_MEASURES.contextToPreview,
      PERF_MARKS.contextReceived,
      {},
      true,
    );
  },
});

let mountApplication: (() => void) | undefined;
let appMounted = false;
const tryMountApplication = () => {
  if (appMounted || !mountApplication || runtime.canonical.snapshot().resetGeneration <= 0) return;
  appMounted = true;
  previewActive = false;
  unsubscribeDocumentReady();
  mountApplication();
};
const unsubscribeDocumentReady = runtime.subscribeHostChange(tryMountApplication);

// Standard Notes posts `component-registered` once from the iframe load
// handler. Register the bridge before requesting React, Milkdown, or the App.
// The bridge-owned preview must render the initial document before React can
// replace it; otherwise fast module loading turns the intended preview metric
// and user-visible startup path into a race.
startEditorRuntime(runtime);
markPerf(PERF_MARKS.mountAppStart, {}, true);
void import("./mountApp.tsx").then(({ mountApp }) => {
  mountApplication = () => mountApp(root, runtime);
  tryMountApplication();
});
