import { runCommand } from "./helpers/process.ts";
import { stat } from "node:fs/promises";
import { test } from "bun:test";

function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}


test("downloader script is executable and outputs valid target path", async () => {
  const fileInfo = await stat("scripts/download-official-sn-apk.sh");
  assertEquals(Boolean(fileInfo.mode && (fileInfo.mode & 0o111) > 0), true);

  const command = runCommand("bash", {
    args: ["scripts/download-official-sn-apk.sh", "--dry-run"],
  });
  const { code, stdout } = await command;
  assertEquals(code, 0);
  const output = new TextDecoder().decode(stdout);
  assertEquals(output.includes("artifacts/standardnotes.apk"), true);
});

test("headless android setup and run scripts are executable", async () => {
  const setupInfo = await stat("scripts/setup-headless-android.sh");
  assertEquals(Boolean(setupInfo.mode && (setupInfo.mode & 0o111) > 0), true);

  const runInfo = await stat("scripts/run-headless-e2e.sh");
  assertEquals(Boolean(runInfo.mode && (runInfo.mode & 0o111) > 0), true);
});
