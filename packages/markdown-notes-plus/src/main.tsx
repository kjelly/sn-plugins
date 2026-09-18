import "./style.css";
import { createEditorRuntime, startEditorRuntime } from "./standardnotes/EditorRuntime.ts";

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
  },
});

// Standard Notes posts `component-registered` once from the iframe load
// handler. Register the bridge before requesting React, Milkdown, or the App.
startEditorRuntime(runtime);
void import("./mountApp.tsx").then(({ mountApp }) => {
  previewActive = false;
  mountApp(root, runtime);
});
