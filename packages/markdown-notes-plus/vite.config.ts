import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const RESTRICTIVE_CSP_HEADER =
  "style-src * 'unsafe-hashes' 'nonce-sn-editor-csp-nonce' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; connect-src https://api.standardnotes.com https://assets.standardnotes.com https://sync.standardnotes.org https://files.standardnotes.com ws://sockets.standardnotes.com https://raw.githubusercontent.com https://listed.to blob:;";

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  server: {
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Security-Policy": RESTRICTIVE_CSP_HEADER,
    },
  },
  preview: {
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Security-Policy": RESTRICTIVE_CSP_HEADER,
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

