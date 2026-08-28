import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("Markdown Notes+ root element is missing");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
