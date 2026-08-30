function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  loadUIPreferences,
  saveUIPreferences,
  DEFAULT_UI_PREFERENCES,
  type UIPreferences,
} from "../src/preferences/UIPreferences.ts";
import { LocalPreferenceStorage } from "../src/standardnotes/PreferenceStorage.ts";

Deno.test("UIPreferences - loads default preferences when empty", () => {
  const storage = new LocalPreferenceStorage();
  const prefs = loadUIPreferences(storage);
  assertEquals(prefs, DEFAULT_UI_PREFERENCES);
});

Deno.test("UIPreferences - saves and loads custom preferences correctly", () => {
  const storage = new LocalPreferenceStorage();
  const customPrefs: UIPreferences = {
    version: 1,
    mode: "mindmap",
    sidebarOpen: false,
    sidebarTab: "review",
    mindmapFilter: "open",
    mindmapScope: "current-section",
    wordWrap: true,
  };

  const saved = saveUIPreferences(customPrefs, storage);
  assertEquals(saved, true);

  const loaded = loadUIPreferences(storage);
  assertEquals(loaded, customPrefs);
});
