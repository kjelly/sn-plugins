/// <reference lib="deno.ns" />

function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(`${message}: expected a string`);
  return value;
}

async function waitForManifest(url: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  let lastError = "server did not become ready";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = `GET ${url} returned HTTP ${response.status}`;
      } else {
        const manifest: unknown = await response.json();
        if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
          throw new Error("manifest response was not a JSON object");
        }
        return manifest as Record<string, unknown>;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(lastError);
}

async function stopVite(child: Deno.ChildProcess, status: Promise<Deno.CommandStatus>): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    // The child may have exited already after a startup failure.
  }
  await status;
}

Deno.test("Vite dev serves the package-root extension manifest", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const child = new Deno.Command("node", {
    args: [
      "node_modules/vite/bin/vite.js",
      "--config",
      "vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    cwd: new URL("..", import.meta.url),
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  const status = child.status;

  try {
    const manifest = await waitForManifest(`http://127.0.0.1:${port}/ext.json`);
    assertEquals(manifest.identifier, "org.standardnotes.markdown-notes-plus");
    assertEquals(manifest.name, "Markdown Notes+");
    assertEquals(manifest.content_type, "SN|Component");
    assertEquals(manifest.area, "editor-editor");
    assertEquals(assertString(manifest.url, "manifest.url"), "http://10.0.2.2:5173/index.html");
  } finally {
    await stopVite(child, status);
  }
});
