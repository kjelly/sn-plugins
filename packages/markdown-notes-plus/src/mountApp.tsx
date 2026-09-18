import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import type { EditorRuntime } from "./standardnotes/EditorRuntime.ts";

export function mountApp(root: HTMLElement, runtime: EditorRuntime): void {
  createRoot(root).render(<React.StrictMode><App runtime={runtime} /></React.StrictMode>);
}
