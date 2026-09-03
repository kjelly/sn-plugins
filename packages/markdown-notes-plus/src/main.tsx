import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App } from "./app/App";
import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("Markdown Notes+ root element is missing");
// Standard Notes posts `component-registered` once from the iframe's load
// handler. React 18 may otherwise defer this first render past that handler,
// leaving ComponentRelay with no listener and the static loading markup on
// screen forever. The synchronous initial commit establishes the bridge
// listener before the iframe load event can be observed by the host.
flushSync(() => {
  createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
});
