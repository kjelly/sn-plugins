import { defineConfig, type Plugin } from "vite";
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

/**
 * Standard Notes downloads a plugin manifest before it creates the editor
 * iframe.  The Android manifest deliberately targets the emulator gateway,
 * so Web E2E needs its own manifest whose editor URL matches the Vite server
 * that Playwright has started.
 *
 * This route exists only on development/preview servers. It is not emitted as
 * part of the release artifact and does not change public/ext.json.
 */
function standardNotesWebE2EManifestPlugin(): Plugin {
  const installRoute = (middlewares: {
    use: (handler: (request: { url?: string; headers: { host?: string } }, response: {
      setHeader: (name: string, value: string) => void;
      end: (body: string) => void;
    }, next: () => void) => void) => void;
  }) => {
    middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== "/e2e/standardnotes-web.ext.json") {
        next();
        return;
      }

      const editorOrigin = process.env.E2E_EDITOR_ORIGIN ?? `http://${request.headers.host ?? "127.0.0.1:5173"}`;
      const editorUrl = new URL("/index.html", editorOrigin).toString();
      const manifest = {
        identifier: "org.standardnotes.markdown-notes-plus",
        name: "Markdown Notes+",
        content_type: "SN|Component",
        area: "editor-editor",
        version: "0.1.0-e2e",
        url: editorUrl,
        file_type: "md",
        note_type: "markdown",
        interchangeable: true,
        showInGallery: false,
      };

      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify(manifest));
    });
  };

  return {
    name: "standardnotes-web-e2e-manifest",
    configureServer(server) {
      installRoute(server.middlewares);
    },
    configurePreviewServer(server) {
      installRoute(server.middlewares);
    },
  };
}

export default defineConfig({
  root: "src",
  publicDir: resolve(__dirname, "public"),
  base: "./",
  plugins: [react(), editorCspMetaPlugin, standardNotesWebE2EManifestPlugin()],
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
        mobileProtocolHost: resolve(__dirname, "src/mobile-protocol-host.html"),
      },
    },
  },
});
