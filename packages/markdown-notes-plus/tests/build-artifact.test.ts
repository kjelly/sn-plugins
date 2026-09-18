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

Deno.test("production editor defers Source and Mind Map chunks", async () => {
  const entryPattern = /<script type="module" crossorigin src="\.\/assets\/(index-[^"]+\.js)"><\/script>/;
  const deferredChunkPattern = /import\("\.\/(SourceEditor|MindMapView)-[^"]+\.js"\)/g;

  for (const path of artifactPaths) {
    const html = await Deno.readTextFile(path);
    const entryMatch = html.match(entryPattern);
    if (!entryMatch) throw new Error(`Missing production entry script in ${path.pathname}`);
    if (/modulepreload[^>]+(?:SourceEditor|MindMapView)-/.test(html)) {
      throw new Error(`Optional editor chunks must not be preloaded by ${path.pathname}`);
    }

    const entryUrl = new URL(`./assets/${entryMatch[1]}`, path);
    const entry = await Deno.readTextFile(entryUrl);
    const deferredChunks = new Set([...entry.matchAll(deferredChunkPattern)].map((match) => match[1]));
    if (!deferredChunks.has("SourceEditor") || !deferredChunks.has("MindMapView")) {
      throw new Error(`Source and Mind Map must remain dynamic imports in ${entryUrl.pathname}`);
    }
    if (new TextEncoder().encode(entry).byteLength >= 1_000_000) {
      throw new Error(`Initial editor entry exceeded the 1 MB performance budget: ${entryUrl.pathname}`);
    }
  }
});
