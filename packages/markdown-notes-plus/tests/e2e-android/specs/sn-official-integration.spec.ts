import { StandardNotesApp } from "../pages/StandardNotesApp.ts";
import { AndroidEditorPage } from "../pages/AndroidEditorPage.ts";
import { createPrerequisiteGate } from "../pages/android-harness.ts";

const SAVED_NOTE_MARKER = "Live Android E2E Test";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
describe("Official Standard Notes Android APK Integration", () => {
  const app = new StandardNotesApp();
  const editor = new AndroidEditorPage();
  const setupPrerequisite = createPrerequisiteGate("Standard Notes Android install and extension setup");

  it("completes setup, exercises the editor, and persists content after reopening", async () => {
    await app.dismissOnboarding();
    await app.openSettings();
    await app.installCustomPlugin("http://10.0.2.2:5173/ext.json");
    await app.createNewNote();
    await app.selectEditor("Markdown Notes+");
    await editor.waitForEditorReady();
    setupPrerequisite.markReady();

    setupPrerequisite.assertReady();

    await editor.typeContent("# Live Android E2E Test\n\n- [ ] Task 1 verified\n");
    await editor.waitForVisibleText(SAVED_NOTE_MARKER);
    await editor.switchMode("Source");
    await editor.switchMode("Writing");
    await editor.waitForVisibleText(SAVED_NOTE_MARKER);

    setupPrerequisite.assertReady();
    await app.returnToNotesList();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.openExistingNote(SAVED_NOTE_MARKER);
      const visibleEditorText = await editor.waitForVisibleText(SAVED_NOTE_MARKER);
      if (!visibleEditorText.includes(SAVED_NOTE_MARKER)) {
        throw new Error(
          `Reopened editor attempt ${attempt} did not contain saved marker: ${JSON.stringify(visibleEditorText)}`,
        );
      }
      if (attempt < 5) await app.returnToNotesList();
    }
  });
});
