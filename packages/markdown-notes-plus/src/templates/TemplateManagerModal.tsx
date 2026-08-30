import React, { useState } from "react";
import {
  type InsertLibrary,
  type TemplateDefinition,
  type SnippetDefinition,
  resolveAllTemplates,
  resolveAllSnippets,
  validateLibraryQuota,
  exportLibraryToJson,
  importLibraryFromJson,
  type ConflictResolutionPolicy,
} from "./TemplateEngine.ts";

export interface TemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  library: InsertLibrary;
  onSaveLibrary: (next: InsertLibrary) => void;
  onInsertTemplate: (template: TemplateDefinition) => void;
  onInsertSnippet: (snippet: SnippetDefinition) => void;
  currentNoteMarkdown: string;
  currentSelectionText?: string;
}

export function TemplateManagerModal({
  isOpen,
  onClose,
  library,
  onSaveLibrary,
  onInsertTemplate,
  onInsertSnippet,
  currentNoteMarkdown,
  currentSelectionText = "",
}: TemplateManagerModalProps) {
  const [tab, setTab] = useState<"templates" | "snippets">("templates");
  const [search, setSearch] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<Partial<TemplateDefinition> | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<Partial<SnippetDefinition> | null>(null);
  const [importConflictPolicy, setImportConflictPolicy] = useState<ConflictResolutionPolicy>("keep-existing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const allTemplates = resolveAllTemplates(library);
  const allSnippets = resolveAllSnippets(library);
  const quota = validateLibraryQuota(library);

  const filteredTemplates = allTemplates.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q)) || (t.description && t.description.toLowerCase().includes(q));
  });

  const filteredSnippets = allSnippets.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.trigger.toLowerCase().includes(q) || (s.category && s.category.toLowerCase().includes(q));
  });

  const handleSaveTemplate = (t: Partial<TemplateDefinition>) => {
    if (!t.name || !t.name.trim()) {
      setErrorMessage("Template name is required.");
      return;
    }
    const now = new Date().toISOString();
    const id = t.id ?? `custom-t-${Date.now()}`;
    const nextTemplates = [...library.templates];
    const existingIndex = nextTemplates.findIndex((item) => item.id === id);

    const updated: TemplateDefinition = {
      id,
      name: t.name.trim(),
      description: t.description?.trim(),
      category: t.category?.trim() || "General",
      content: t.content ?? "",
      createdAt: t.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      nextTemplates[existingIndex] = updated;
    } else {
      nextTemplates.push(updated);
    }

    const nextLib = { ...library, templates: nextTemplates };
    const q = validateLibraryQuota(nextLib);
    if (!q.valid) {
      setErrorMessage(q.message ?? "Quota exceeded.");
      return;
    }

    onSaveLibrary(nextLib);
    setEditingTemplate(null);
    setErrorMessage(null);
  };

  const handleDeleteTemplate = (id: string, isBuiltin?: boolean) => {
    if (isBuiltin) {
      const hidden = new Set(library.hiddenBuiltins ?? []);
      hidden.add(id);
      onSaveLibrary({ ...library, hiddenBuiltins: Array.from(hidden) });
    } else {
      const nextTemplates = library.templates.filter((t) => t.id !== id);
      onSaveLibrary({ ...library, templates: nextTemplates });
    }
  };

  const handleDuplicateTemplate = (t: TemplateDefinition) => {
    const copy: Partial<TemplateDefinition> = {
      id: `custom-t-${Date.now()}`,
      name: `${t.name} (Copy)`,
      description: t.description,
      category: t.category,
      content: t.content,
    };
    handleSaveTemplate(copy);
  };

  const handleSaveSnippet = (s: Partial<SnippetDefinition>) => {
    if (!s.name || !s.name.trim()) {
      setErrorMessage("Snippet name is required.");
      return;
    }
    if (!s.trigger || !s.trigger.trim()) {
      setErrorMessage("Snippet trigger shortcut is required.");
      return;
    }
    const cleanTrigger = s.trigger.trim().replace(/^\//, "");
    const now = new Date().toISOString();
    const id = s.id ?? `custom-s-${Date.now()}`;
    const nextSnippets = [...library.snippets];
    const existingIndex = nextSnippets.findIndex((item) => item.id === id);

    const updated: SnippetDefinition = {
      id,
      name: s.name.trim(),
      description: s.description?.trim(),
      category: s.category?.trim() || "General",
      trigger: cleanTrigger,
      content: s.content ?? "",
      createdAt: s.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      nextSnippets[existingIndex] = updated;
    } else {
      nextSnippets.push(updated);
    }

    const nextLib = { ...library, snippets: nextSnippets };
    const q = validateLibraryQuota(nextLib);
    if (!q.valid) {
      setErrorMessage(q.message ?? "Quota exceeded.");
      return;
    }

    onSaveLibrary(nextLib);
    setEditingSnippet(null);
    setErrorMessage(null);
  };

  const handleDeleteSnippet = (id: string, isBuiltin?: boolean) => {
    if (isBuiltin) {
      const hidden = new Set(library.hiddenBuiltins ?? []);
      hidden.add(id);
      onSaveLibrary({ ...library, hiddenBuiltins: Array.from(hidden) });
    } else {
      const nextSnippets = library.snippets.filter((s) => s.id !== id);
      onSaveLibrary({ ...library, snippets: nextSnippets });
    }
  };

  const handleDuplicateSnippet = (s: SnippetDefinition) => {
    const copy: Partial<SnippetDefinition> = {
      id: `custom-s-${Date.now()}`,
      name: `${s.name} (Copy)`,
      description: s.description,
      category: s.category,
      trigger: `${s.trigger}_copy`,
      content: s.content,
    };
    handleSaveSnippet(copy);
  };

  const handleExportJson = () => {
    const jsonStr = exportLibraryToJson(library);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "markdown-notes-plus-library.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      const res = importLibraryFromJson(library, content, importConflictPolicy);
      if (res.errors && res.errors.length > 0) {
        setErrorMessage(res.errors.join(", "));
        return;
      }
      onSaveLibrary(res.library);
      setErrorMessage(null);
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="template-modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Template and Snippet Manager">
        <header className="template-modal-header">
          <div className="template-modal-tabs">
            <button
              type="button"
              className={`tab-btn ${tab === "templates" ? "active" : ""}`}
              onClick={() => { setTab("templates"); setEditingTemplate(null); setEditingSnippet(null); }}
            >
              Templates ({allTemplates.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${tab === "snippets" ? "active" : ""}`}
              onClick={() => { setTab("snippets"); setEditingTemplate(null); setEditingSnippet(null); }}
            >
              Snippets ({allSnippets.length})
            </button>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close modal">✕</button>
        </header>

        {errorMessage ? <div className="template-error-banner">{errorMessage}</div> : null}

        <div className="template-modal-toolbar">
          <input
            type="search"
            className="template-search-input"
            placeholder={`Search ${tab}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {tab === "templates" ? (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setEditingTemplate({ name: "", content: "# {{noteTitle}}\n\n{{cursor}}" })}
              >
                + New Template
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditingTemplate({ name: "Note Template", content: currentNoteMarkdown })}
                title="Capture current note markdown as a template"
              >
                Save Current Note
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setEditingSnippet({ name: "", trigger: "", content: "{{cursor}}" })}
              >
                + New Snippet
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!currentSelectionText.trim()}
                onClick={() => setEditingSnippet({ name: "Selection Snippet", trigger: "sel", content: currentSelectionText })}
                title="Capture current selection as a snippet"
              >
                Save Selection
              </button>
            </>
          )}
        </div>

        {/* Editor Form for Template */}
        {editingTemplate ? (
          <div className="template-edit-form">
            <h3>{editingTemplate.id ? "Edit Template" : "New Template"}</h3>
            <div className="form-group">
              <label>Name: <input type="text" value={editingTemplate.name ?? ""} onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })} placeholder="e.g. Project Plan" /></label>
              <label>Category: <input type="text" value={editingTemplate.category ?? ""} onChange={(e) => setEditingTemplate({ ...editingTemplate, category: e.target.value })} placeholder="e.g. Work" /></label>
            </div>
            <div className="form-group">
              <label>Description: <input type="text" value={editingTemplate.description ?? ""} onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })} placeholder="Short description" /></label>
            </div>
            <div className="form-group">
              <label>Markdown Content: <span className="variable-hints">Variables: <code>{"{{date}}"}</code>, <code>{"{{time}}"}</code>, <code>{"{{datetime}}"}</code>, <code>{"{{noteTitle}}"}</code>, <code>{"{{selection}}"}</code>, <code>{"{{cursor}}"}</code></span>
                <textarea
                  rows={8}
                  value={editingTemplate.content ?? ""}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-primary" onClick={() => handleSaveTemplate(editingTemplate)}>Save Template</button>
              <button type="button" className="btn-secondary" onClick={() => setEditingTemplate(null)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {/* Editor Form for Snippet */}
        {editingSnippet ? (
          <div className="template-edit-form">
            <h3>{editingSnippet.id ? "Edit Snippet" : "New Snippet"}</h3>
            <div className="form-group">
              <label>Name: <input type="text" value={editingSnippet.name ?? ""} onChange={(e) => setEditingSnippet({ ...editingSnippet, name: e.target.value })} placeholder="e.g. Decision Record" /></label>
              <label>Trigger Shortcut: <input type="text" value={editingSnippet.trigger ?? ""} onChange={(e) => setEditingSnippet({ ...editingSnippet, trigger: e.target.value })} placeholder="e.g. decision (type /decision)" /></label>
            </div>
            <div className="form-group">
              <label>Category: <input type="text" value={editingSnippet.category ?? ""} onChange={(e) => setEditingSnippet({ ...editingSnippet, category: e.target.value })} placeholder="e.g. Architecture" /></label>
            </div>
            <div className="form-group">
              <label>Snippet Content: <span className="variable-hints">Variables: <code>{"{{date}}"}</code>, <code>{"{{cursor}}"}</code>, <code>{"{{selection}}"}</code></span>
                <textarea
                  rows={6}
                  value={editingSnippet.content ?? ""}
                  onChange={(e) => setEditingSnippet({ ...editingSnippet, content: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-primary" onClick={() => handleSaveSnippet(editingSnippet)}>Save Snippet</button>
              <button type="button" className="btn-secondary" onClick={() => setEditingSnippet(null)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {/* List of items */}
        {!editingTemplate && !editingSnippet ? (
          <div className="template-card-grid">
            {tab === "templates" ? (
              filteredTemplates.length > 0 ? (
                filteredTemplates.map((t) => (
                  <div key={t.id} className="template-card">
                    <div className="template-card-header">
                      <h4>{t.name}</h4>
                      <span className="badge">{t.category ?? "General"}</span>
                      {t.isBuiltin ? <span className="badge builtin-badge">Built-in</span> : null}
                    </div>
                    {t.description ? <p className="template-desc">{t.description}</p> : null}
                    <div className="template-card-actions">
                      <button
                        type="button"
                        className="btn-action btn-insert"
                        onClick={() => { onInsertTemplate(t); onClose(); }}
                        title="Insert template into note"
                      >
                        Insert
                      </button>
                      {!t.isBuiltin ? (
                        <button
                          type="button"
                          className="btn-action"
                          onClick={() => setEditingTemplate(t)}
                          title="Edit template"
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-action"
                        onClick={() => handleDuplicateTemplate(t)}
                        title="Duplicate as new custom template"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn-action btn-delete"
                        onClick={() => handleDeleteTemplate(t.id, t.isBuiltin)}
                        title={t.isBuiltin ? "Hide built-in template" : "Delete template"}
                      >
                        {t.isBuiltin ? "Hide" : "Delete"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-hint">No templates found.</p>
              )
            ) : (
              filteredSnippets.length > 0 ? (
                filteredSnippets.map((s) => (
                  <div key={s.id} className="template-card">
                    <div className="template-card-header">
                      <h4>{s.name}</h4>
                      <span className="badge trigger-badge">/{s.trigger}</span>
                      <span className="badge">{s.category ?? "General"}</span>
                      {s.isBuiltin ? <span className="badge builtin-badge">Built-in</span> : null}
                    </div>
                    {s.description ? <p className="template-desc">{s.description}</p> : null}
                    <div className="template-card-actions">
                      <button
                        type="button"
                        className="btn-action btn-insert"
                        onClick={() => { onInsertSnippet(s); onClose(); }}
                        title="Insert snippet into note"
                      >
                        Insert
                      </button>
                      {!s.isBuiltin ? (
                        <button
                          type="button"
                          className="btn-action"
                          onClick={() => setEditingSnippet(s)}
                          title="Edit snippet"
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-action"
                        onClick={() => handleDuplicateSnippet(s)}
                        title="Duplicate snippet"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn-action btn-delete"
                        onClick={() => handleDeleteSnippet(s.id, s.isBuiltin)}
                        title={s.isBuiltin ? "Hide built-in snippet" : "Delete snippet"}
                      >
                        {s.isBuiltin ? "Hide" : "Delete"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-hint">No snippets found.</p>
              )
            )}
          </div>
        ) : null}

        <footer className="template-modal-footer">
          <div className="library-quota-info">
            Library size: {Math.round(quota.sizeBytes / 1024)} KB / 512 KB
          </div>
          <div className="import-export-group">
            <select
              value={importConflictPolicy}
              onChange={(e) => setImportConflictPolicy(e.target.value as ConflictResolutionPolicy)}
              title="Import conflict resolution policy"
            >
              <option value="keep-existing">Keep existing</option>
              <option value="import-copy">Import as copy</option>
              <option value="replace-all">Replace all</option>
            </select>
            <label className="btn-file-import">
              Import JSON
              <input type="file" accept=".json" onChange={handleImportJson} style={{ display: "none" }} />
            </label>
            <button type="button" className="btn-secondary" onClick={handleExportJson}>Export JSON</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
