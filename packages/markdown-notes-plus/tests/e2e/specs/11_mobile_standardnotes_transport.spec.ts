import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test("mobile Component API uses JSON strings for registration, context, and saves", async ({ page }) => {
  const host = new MockHost(page);
  const editor = new EditorPage(page);

  await host.goto("# Mobile Note\n\nInitial mobile content.\n", "mobile-note-uuid", false, true);

  await expect(editor.status).toHaveText("Ready");
  await expect(editor.outlineHeadings.first()).toHaveText("Mobile Note");
  expect(await host.getProtocolViolations()).toEqual([]);

  await editor.switchMode("Source");
  await editor.sourceEditor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nSaved from mobile transport.");
  await host.waitForNextSave(4000);

  expect(await host.getLatestSavedText()).toContain("Saved from mobile transport.");
  expect(await host.getProtocolViolations()).toEqual([]);
  const latestSaveIsString = await page.evaluate(() => {
    const save = (window as unknown as { __SN_MOCK_HOST__: { getLatestSave: () => { raw: unknown } } }).__SN_MOCK_HOST__.getLatestSave();
    return typeof save?.raw === "string";
  });
  expect(latestSaveIsString).toBe(true);
});
