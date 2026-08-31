import { StandardNotesApp } from "../pages/StandardNotesApp.ts";
import { AndroidEditorPage } from "../pages/AndroidEditorPage.ts";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const $: (selector: string) => Promise<{
  click(): Promise<void>;
  waitForDisplayed(opts?: { timeout?: number }): Promise<void>;
}>;

describe("Official Standard Notes Android APK Integration", () => {
  const app = new StandardNotesApp();
  const editor = new AndroidEditorPage();

  it("completes onboarding and installs Markdown Notes+ custom extension", async () => {
    await app.dismissOnboarding();
    await app.openSettings();
    await app.installCustomPlugin("http://10.0.2.2:5173/ext.json");
  });

  it("creates a note and activates Markdown Notes+ editor", async () => {
    await app.createNewNote();
    await app.selectEditor("Markdown Notes+");
    await editor.waitForEditorReady();
  });

  it("enters content and switches projection modes", async () => {
    await editor.typeContent("# Live Android E2E Test\n\n- [ ] Task 1 verified\n");
    await editor.switchMode("Source");
    await editor.switchMode("Tasks");
    await editor.switchMode("Writing");
  });

  it("persists content when returning to note list and reopening", async () => {
    await app.returnToNotesList();
    const noteEntry = await $('//*[@text="Live Android E2E Test" or contains(@text, "Live Android E2E")]');
    await noteEntry.waitForDisplayed({ timeout: 10000 });
    await noteEntry.click();

    await editor.waitForEditorReady();
  });
});
