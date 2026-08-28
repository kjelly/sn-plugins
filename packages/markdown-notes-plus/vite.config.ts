import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/index.html"),
      },
    },
  },
});

