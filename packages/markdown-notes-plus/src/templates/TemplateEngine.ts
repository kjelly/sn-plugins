import { BUILTIN_TEMPLATES, BUILTIN_SNIPPETS } from "./BuiltinTemplates.ts";

export interface TemplateDefinition {
  id: string;
  name: string;
  description?: string;
  category?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isBuiltin?: boolean;
}

export interface SnippetDefinition {
  id: string;
  name: string;
  description?: string;
  category?: string;
  trigger: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isBuiltin?: boolean;
}

export interface InsertLibrary {
  schemaVersion: 1;
  templates: TemplateDefinition[];
  snippets: SnippetDefinition[];
  hiddenBuiltins?: string[];
}

export const MAX_TEMPLATE_BYTES = 64 * 1024;
export const MAX_SNIPPET_BYTES = 16 * 1024;
export const MAX_LIBRARY_BYTES = 512 * 1024;

export const COMPONENT_PREF_KEY = "insertLibrary.v1";
export const STORAGE_PREFIX = "com.kjelly.markdown-notes-plus:insertLibrary.v1";

export function createEmptyLibrary(): InsertLibrary {
  return {
    schemaVersion: 1,
    templates: [],
    snippets: [],
    hiddenBuiltins: [],
  };
}

export function computeByteSize(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function validateLibraryQuota(library: InsertLibrary): { valid: boolean; sizeBytes: number; message?: string } {
  const jsonStr = JSON.stringify(library);
  const sizeBytes = computeByteSize(jsonStr);

  for (const t of library.templates) {
    const tSize = computeByteSize(t.content);
    if (tSize > MAX_TEMPLATE_BYTES) {
      return {
        valid: false,
        sizeBytes,
        message: `Template "${t.name}" exceeds 64 KB limit (${Math.round(tSize / 1024)} KB)`,
      };
    }
  }

  for (const s of library.snippets) {
    const sSize = computeByteSize(s.content);
    if (sSize > MAX_SNIPPET_BYTES) {
      return {
        valid: false,
        sizeBytes,
        message: `Snippet "${s.name}" exceeds 16 KB limit (${Math.round(sSize / 1024)} KB)`,
      };
    }
  }

  if (sizeBytes > MAX_LIBRARY_BYTES) {
    return {
      valid: false,
      sizeBytes,
      message: `Total Library size exceeds 512 KB limit (${Math.round(sizeBytes / 1024)} KB)`,
    };
  }

  return { valid: true, sizeBytes };
}

export interface VariableContext {
  date?: Date;
  noteTitle?: string;
  selection?: string;
}

export function extractNoteTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) return h1Match[1].trim();
  }
  return "Untitled";
}

export function formatTemplateDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatTemplateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatTemplateDateTime(d: Date): string {
  return `${formatTemplateDate(d)} ${formatTemplateTime(d)}`;
}

/**
 * Expand variables in template or snippet content:
 * - {{date}}
 * - {{time}}
 * - {{datetime}}
 * - {{noteTitle}}
 * - {{selection}}
 * - {{cursor}}
 */
export function expandTemplateVariables(
  content: string,
  context: VariableContext = {},
): { text: string; cursorOffset?: number } {
  const now = context.date ?? new Date();
  const dateStr = formatTemplateDate(now);
  const timeStr = formatTemplateTime(now);
  const dateTimeStr = formatTemplateDateTime(now);
  const titleStr = context.noteTitle ?? "Untitled";
  const selectionStr = context.selection ?? "";

  let expanded = content
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{time\}\}/g, timeStr)
    .replace(/\{\{datetime\}\}/g, dateTimeStr)
    .replace(/\{\{noteTitle\}\}/g, titleStr)
    .replace(/\{\{selection\}\}/g, selectionStr);

  const cursorMarker = "{{cursor}}";
  const cursorIndex = expanded.indexOf(cursorMarker);
  let cursorOffset: number | undefined = undefined;

  if (cursorIndex !== -1) {
    cursorOffset = cursorIndex;
    expanded = expanded.replace(/\{\{cursor\}\}/g, "");
  }

  return { text: expanded, cursorOffset };
}

export function resolveAllTemplates(library: InsertLibrary): TemplateDefinition[] {
  const hidden = new Set(library.hiddenBuiltins ?? []);
  const builtins: TemplateDefinition[] = BUILTIN_TEMPLATES
    .filter((b) => !hidden.has(b.id))
    .map((b) => ({ ...b, isBuiltin: true }));
  return [...builtins, ...library.templates];
}

export function resolveAllSnippets(library: InsertLibrary): SnippetDefinition[] {
  const hidden = new Set(library.hiddenBuiltins ?? []);
  const builtins: SnippetDefinition[] = BUILTIN_SNIPPETS
    .filter((b) => !hidden.has(b.id))
    .map((b) => ({ ...b, isBuiltin: true }));
  return [...builtins, ...library.snippets];
}

export function exportLibraryToJson(library: InsertLibrary): string {
  return JSON.stringify(library, null, 2);
}

export type ConflictResolutionPolicy = "keep-existing" | "replace-all" | "import-copy";

export function importLibraryFromJson(
  current: InsertLibrary,
  jsonStr: string,
  policy: ConflictResolutionPolicy = "keep-existing",
): { library: InsertLibrary; addedTemplates: number; addedSnippets: number; errors?: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { library: current, addedTemplates: 0, addedSnippets: 0, errors: [`Invalid JSON format: ${String(e)}`] };
  }

  if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).schemaVersion !== 1) {
    return { library: current, addedTemplates: 0, addedSnippets: 0, errors: ["Unsupported schemaVersion or invalid library format"] };
  }

  const incoming = parsed as InsertLibrary;
  const inTemplates = Array.isArray(incoming.templates) ? incoming.templates : [];
  const inSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : [];

  if (policy === "replace-all") {
    const next: InsertLibrary = {
      schemaVersion: 1,
      templates: inTemplates.filter((t) => !t.isBuiltin),
      snippets: inSnippets.filter((s) => !s.isBuiltin),
      hiddenBuiltins: incoming.hiddenBuiltins ?? [],
    };
    return {
      library: next,
      addedTemplates: next.templates.length,
      addedSnippets: next.snippets.length,
    };
  }

  const existingTemplateIds = new Set(current.templates.map((t) => t.id));
  const existingSnippetIds = new Set(current.snippets.map((s) => s.id));
  const existingSnippetTriggers = new Set(current.snippets.map((s) => s.trigger));

  const nextTemplates = [...current.templates];
  const nextSnippets = [...current.snippets];
  let addedT = 0;
  let addedS = 0;

  for (const t of inTemplates) {
    if (t.isBuiltin) continue;
    if (policy === "keep-existing") {
      if (!existingTemplateIds.has(t.id)) {
        nextTemplates.push(t);
        existingTemplateIds.add(t.id);
        addedT++;
      }
    } else if (policy === "import-copy") {
      let id = t.id;
      let name = t.name;
      if (existingTemplateIds.has(id)) {
        id = `${t.id}-copy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        name = `${t.name} (Copy)`;
      }
      nextTemplates.push({ ...t, id, name });
      existingTemplateIds.add(id);
      addedT++;
    }
  }

  for (const s of inSnippets) {
    if (s.isBuiltin) continue;
    if (policy === "keep-existing") {
      if (!existingSnippetIds.has(s.id)) {
        nextSnippets.push(s);
        existingSnippetIds.add(s.id);
        addedS++;
      }
    } else if (policy === "import-copy") {
      let id = s.id;
      let name = s.name;
      let trigger = s.trigger;
      if (existingSnippetIds.has(id)) {
        id = `${s.id}-copy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        name = `${s.name} (Copy)`;
      }
      if (existingSnippetTriggers.has(trigger)) {
        trigger = `${s.trigger}_copy`;
      }
      nextSnippets.push({ ...s, id, name, trigger });
      existingSnippetIds.add(id);
      existingSnippetTriggers.add(trigger);
      addedS++;
    }
  }

  const mergedHidden = Array.from(new Set([...(current.hiddenBuiltins ?? []), ...(incoming.hiddenBuiltins ?? [])]));

  const nextLibrary: InsertLibrary = {
    schemaVersion: 1,
    templates: nextTemplates,
    snippets: nextSnippets,
    hiddenBuiltins: mergedHidden,
  };

  return {
    library: nextLibrary,
    addedTemplates: addedT,
    addedSnippets: addedS,
  };
}
