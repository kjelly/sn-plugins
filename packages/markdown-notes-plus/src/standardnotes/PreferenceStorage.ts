import {
  type InsertLibrary,
  createEmptyLibrary,
  validateLibraryQuota,
  STORAGE_PREFIX,
} from "../templates/TemplateEngine.ts";

export interface PreferenceStorageAdapter {
  loadLibrary(): InsertLibrary;
  saveLibrary(library: InsertLibrary): boolean;
}

export class LocalPreferenceStorage implements PreferenceStorageAdapter {
  private memoryCache?: InsertLibrary;

  constructor(private readonly storageKey: string = STORAGE_PREFIX) {}

  loadLibrary(): InsertLibrary {
    if (this.memoryCache) return this.memoryCache;

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && parsed.schemaVersion === 1) {
            this.memoryCache = parsed as InsertLibrary;
            return this.memoryCache;
          }
        }
      } catch (_e) {
        // ignore parse error, fallback to empty
      }
    }

    this.memoryCache = createEmptyLibrary();
    return this.memoryCache;
  }

  saveLibrary(library: InsertLibrary): boolean {
    const quota = validateLibraryQuota(library);
    if (!quota.valid) {
      console.warn("Library quota exceeded:", quota.message);
      return false;
    }

    this.memoryCache = library;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(library));
        return true;
      } catch (e) {
        console.warn("Failed to persist library to localStorage:", e);
        return false;
      }
    }
    return true;
  }
}
