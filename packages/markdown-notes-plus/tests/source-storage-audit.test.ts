declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  readDir(path: string | URL): AsyncIterable<{ name: string; isDirectory: boolean; isFile: boolean }>;
  readTextFile(path: string | URL): Promise<string>;
};

const forbiddenProductReferences = [
  "localStorage",
  "sessionStorage",
  "LocalPreferenceStorage",
  "PreferenceStorageAdapter",
  "loadUIPreferences",
  "saveUIPreferences",
  "UI_PREFERENCES_STORAGE_KEY",
  "COMPONENT_PREF_KEY",
  "STORAGE_PREFIX",
  "com.kjelly.markdown-notes-plus:uiPreferences.v1",
  "insertLibrary.v1",
  "com.kjelly.markdown-notes-plus:insertLibrary.v1",
];

async function collectSourceFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory) files.push(...await collectSourceFiles(new URL(`${entry.name}/`, directory)));
    else if (entry.isFile) files.push(path);
  }
  return files.sort((left, right) => left.href.localeCompare(right.href));
}

Deno.test("product source contains no removed browser storage references", async () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  const violations: string[] = [];

  for (const file of await collectSourceFiles(sourceDirectory)) {
    const source = await Deno.readTextFile(file);
    for (const reference of forbiddenProductReferences) {
      if (source.includes(reference)) violations.push(`${file.pathname}: ${reference}`);
    }
  }

  if (violations.length > 0) {
    throw new Error(`Forbidden product storage references found:\n${violations.join("\n")}`);
  }
});
