import {
  type InsertLibrary,
  createEmptyLibrary,
  validateLibraryQuota,
  STORAGE_PREFIX,
} from "../templates/TemplateEngine.ts";

export interface PreferenceStorageAdapter {
  loadLibrary(): InsertLibrary;
  saveLibrary(library: InsertLibrary): boolean;
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
}

export class LocalPreferenceStorage implements PreferenceStorageAdapter {
  private memoryCache?: InsertLibrary;
  private rawStorage: Map<string, string> = new Map();

  constructor(private readonly _storageKey: string = STORAGE_PREFIX) {}

  getItem(key: string): string | null {
    return this.rawStorage.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.rawStorage.set(key, value);
  }

  loadLibrary(): InsertLibrary {
    if (this.memoryCache) return this.memoryCache;
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
    return true;
  }
}
