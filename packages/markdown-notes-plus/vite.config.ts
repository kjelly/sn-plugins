import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { EDITOR_CSP_POLICY } from "./src/security/csp";

const editorCspMeta = `<meta http-equiv="Content-Security-Policy" content="${EDITOR_CSP_POLICY}">`;

const editorCspMetaPlugin = {
  name: "editor-csp-meta",
  transformIndexHtml(html: string, context: { filename?: string }) {
    if (context.filename && !context.filename.endsWith("/index.html") && context.filename !== "index.html") return html;
    return html.replace("<head>", `<head>\n    ${editorCspMeta}`);
  },
};

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react(), editorCspMetaPlugin],
  server: {
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Security-Policy": EDITOR_CSP_POLICY,
    },
  },
  preview: {
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Security-Policy": EDITOR_CSP_POLICY,
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/index.html"),
        testHost: resolve(__dirname, "src/test-host.html"),
      },
    },
  },
});
