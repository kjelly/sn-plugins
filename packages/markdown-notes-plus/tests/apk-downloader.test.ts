function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/// <reference lib="deno.ns" />

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  stat(path: string | URL): Promise<{ mode: number | null }>;
  Command: new (
    command: string,
    options?: { args?: string[]; stdout?: string; stderr?: string }
  ) => {
    output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
  };
};

Deno.test("downloader script is executable and outputs valid target path", async () => {
  const fileInfo = await Deno.stat("scripts/download-official-sn-apk.sh");
  assertEquals(Boolean(fileInfo.mode && (fileInfo.mode & 0o111) > 0), true);

  const command = new Deno.Command("bash", {
    args: ["scripts/download-official-sn-apk.sh", "--dry-run"],
  });
  const { code, stdout } = await command.output();
  assertEquals(code, 0);
  const output = new TextDecoder().decode(stdout);
  assertEquals(output.includes("artifacts/standardnotes.apk"), true);
});
