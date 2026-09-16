declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  readTextFile(path: string | URL): Promise<string>;
};

import { EDITOR_CSP_POLICY, MERMAID_RENDERER_CSP_POLICY } from "../src/security/csp.ts";

const artifactPaths = [
  new URL("../dist/index.html", import.meta.url),
  new URL("../../../dist-pages/static/markdown-notes-plus/dist/index.html", import.meta.url),
];

const rendererArtifactPaths = [
  new URL("../dist/mermaid-renderer.html", import.meta.url),
  new URL("../../../dist-pages/static/markdown-notes-plus/dist/mermaid-renderer.html", import.meta.url),
];

Deno.test("production editor artifacts carry the shared CSP meta policy", async () => {
  const metaPattern = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/;
  const policies = [] as string[];
  for (const path of artifactPaths) {
    const html = await Deno.readTextFile(path);
    const match = html.match(metaPattern);
    if (!match) throw new Error(`Missing CSP meta in ${path.pathname}`);
    policies.push(match[1]);
  }

  if (policies.some((policy) => policy !== EDITOR_CSP_POLICY)) {
    throw new Error("Editor artifacts must use the exact Vite CSP policy");
  }
  if (policies.some((policy) => policy.includes("script-src") || !policy.includes("style-src") || !policy.includes("connect-src"))) {
    throw new Error("Editor artifact CSP must retain style/connect allowlists without script-src");
  }
});

Deno.test("production Mermaid renderer artifacts have a network-denying isolated CSP", async () => {
  const metaPattern = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/;
  for (const path of rendererArtifactPaths) {
    const html = await Deno.readTextFile(path);
    const match = html.match(metaPattern);
    if (!match) throw new Error(`Missing renderer CSP meta in ${path.pathname}`);
    if (match[1] !== MERMAID_RENDERER_CSP_POLICY) {
      throw new Error("Mermaid renderer artifacts must use the exact isolated CSP policy");
    }
    if (!match[1].includes("default-src 'none'") || !match[1].includes("connect-src 'none'")) {
      throw new Error("Mermaid renderer CSP must deny network access by default");
    }
  }
});
