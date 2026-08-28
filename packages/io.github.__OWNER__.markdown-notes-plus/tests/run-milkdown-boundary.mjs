import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "markdown-notes-plus-integration-"));
const outfile = join(directory, "milkdown-boundary.mjs");
try {
  await build({
    entryPoints: ["tests/milkdown-boundary.test.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    sourcemap: false,
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
