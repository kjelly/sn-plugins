import { LocalPreferenceStorage } from "../standardnotes/PreferenceStorage.ts";

export interface UIPreferences {
  version: 1;
  mode: "writing" | "source" | "split" | "mindmap";
  sidebarOpen: boolean;
  sidebarTab: "outline" | "review" | "tasks";
  mindmapFilter: "all" | "open" | "hide";
  mindmapScope: "entire-note" | "current-section";
  wordWrap: boolean;
}

export const UI_PREFERENCES_STORAGE_KEY = "com.kjelly.markdown-notes-plus:uiPreferences.v1";

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  version: 1,
  mode: "writing",
  sidebarOpen: true,
  sidebarTab: "outline",
  mindmapFilter: "all",
  mindmapScope: "entire-note",
  wordWrap: true,
};

export function loadUIPreferences(storage: LocalPreferenceStorage = new LocalPreferenceStorage()): UIPreferences {
  try {
    const raw = storage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) {
      return {
        version: 1,
        mode: ["writing", "source", "split", "mindmap"].includes(parsed.mode) ? parsed.mode : DEFAULT_UI_PREFERENCES.mode,
        sidebarOpen: typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : DEFAULT_UI_PREFERENCES.sidebarOpen,
        sidebarTab: ["outline", "review", "tasks"].includes(parsed.sidebarTab) ? parsed.sidebarTab : DEFAULT_UI_PREFERENCES.sidebarTab,
        mindmapFilter: ["all", "open", "hide"].includes(parsed.mindmapFilter) ? parsed.mindmapFilter : DEFAULT_UI_PREFERENCES.mindmapFilter,
        mindmapScope: ["entire-note", "current-section"].includes(parsed.mindmapScope) ? parsed.mindmapScope : DEFAULT_UI_PREFERENCES.mindmapScope,
        wordWrap: typeof parsed.wordWrap === "boolean" ? parsed.wordWrap : DEFAULT_UI_PREFERENCES.wordWrap,
      };
    }
  } catch {
    // Fallback to defaults
  }
  return DEFAULT_UI_PREFERENCES;
}

export function saveUIPreferences(
  prefs: UIPreferences,
  storage: LocalPreferenceStorage = new LocalPreferenceStorage(),
): boolean {
  try {
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
