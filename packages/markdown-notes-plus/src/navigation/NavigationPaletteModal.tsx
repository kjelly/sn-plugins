import React, { useState, useEffect, useRef, useMemo } from "react";
import type { MarkdownAnalysis } from "../markdown/analysis.ts";
import {
  type InsertLibrary,
  type TemplateDefinition,
  type SnippetDefinition,
  resolveAllTemplates,
  resolveAllSnippets,
} from "../templates/TemplateEngine.ts";

export type PaletteItemKind = "heading" | "task" | "command" | "template" | "snippet";

export interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  title: string;
  subtitle?: string;
  badge?: string;
  action: () => void;
}

export interface NavigationPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: MarkdownAnalysis;
  onSelectHeading: (anchor: number) => void;
  onSetMode: (mode: "writing" | "source" | "split" | "mindmap") => void;
  onToggleSidebar: () => void;
  onOpenTemplates: () => void;
  onFixAllIssues?: () => void;
  library?: InsertLibrary;
  onInsertTemplate?: (template: TemplateDefinition) => void;
  onInsertSnippet?: (snippet: SnippetDefinition) => void;
}

export function NavigationPaletteModal({
  isOpen,
  onClose,
  analysis,
  onSelectHeading,
  onSetMode,
  onToggleSidebar,
  onOpenTemplates,
  onFixAllIssues,
  library,
  onInsertTemplate,
  onInsertSnippet,
}: NavigationPaletteModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const allItems: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [];

    // 1. Commands
    items.push({
      id: "cmd-mode-writing",
      kind: "command",
      title: "Switch to Writing Mode",
      subtitle: "WYSIWYG Markdown Editor",
      badge: "Mode",
      action: () => { onSetMode("writing"); onClose(); },
    });
    items.push({
      id: "cmd-mode-source",
      kind: "command",
      title: "Switch to Source Mode",
      subtitle: "CodeMirror Raw Markdown",
      badge: "Mode",
      action: () => { onSetMode("source"); onClose(); },
    });
    items.push({
      id: "cmd-mode-split",
      kind: "command",
      title: "Switch to Split Mode",
      subtitle: "Editor + Live Mindmap",
      badge: "Mode",
      action: () => { onSetMode("split"); onClose(); },
    });
    items.push({
      id: "cmd-mode-mindmap",
      kind: "command",
      title: "Switch to Mindmap Mode",
      subtitle: "Visual Outline Graph",
      badge: "Mode",
      action: () => { onSetMode("mindmap"); onClose(); },
    });
    items.push({
      id: "cmd-toggle-sidebar",
      kind: "command",
      title: "Toggle Sidebar Inspector",
      subtitle: "Outline / Review / Tasks",
      badge: "View",
      action: () => { onToggleSidebar(); onClose(); },
    });
    items.push({
      id: "cmd-open-templates",
      kind: "command",
      title: "Templates & Snippets Manager",
      subtitle: "Create, edit and insert templates",
      badge: "Tool",
      action: () => { onOpenTemplates(); onClose(); },
    });
    if (onFixAllIssues) {
      items.push({
        id: "cmd-fix-all",
        kind: "command",
        title: "Fix All Safe Document Issues",
        subtitle: "Auto-fix heading jumps and empty headings",
        badge: "Review",
        action: () => { onFixAllIssues(); onClose(); },
      });
    }

    // 2. Headings
    analysis.headings.forEach((heading, idx) => {
      items.push({
        id: `heading-${idx}-${heading.from}`,
        kind: "heading",
        title: heading.text || "Untitled Heading",
        subtitle: heading.path.length > 1 ? heading.path.slice(0, -1).join(" > ") : undefined,
        badge: `H${heading.level}`,
        action: () => { onSelectHeading(heading.from); onClose(); },
      });
    });

    // 3. Tasks
    analysis.tasks.forEach((task, idx) => {
      items.push({
        id: `task-${idx}-${task.from}`,
        kind: "task",
        title: task.text || "Untitled Task",
        subtitle: task.headingPath.length > 0 ? task.headingPath.join(" > ") : undefined,
        badge: task.checked ? "Done" : "Todo",
        action: () => { onSelectHeading(task.from); onClose(); },
      });
    });

    // 4. Templates & Snippets
    if (library) {
      const templates = resolveAllTemplates(library);
      for (const t of templates) {
        items.push({
          id: `template-${t.id}`,
          kind: "template",
          title: `Insert: ${t.name}`,
          subtitle: t.description || t.category,
          badge: "Template",
          action: () => { onInsertTemplate?.(t); onClose(); },
        });
      }
      const snippets = resolveAllSnippets(library);
      for (const s of snippets) {
        items.push({
          id: `snippet-${s.id}`,
          kind: "snippet",
          title: `Insert: ${s.name} (/${s.trigger})`,
          subtitle: s.content.slice(0, 40),
          badge: "Snippet",
          action: () => { onInsertSnippet?.(s); onClose(); },
        });
      }
    }

    return items;
  }, [analysis, library, onClose, onFixAllIssues, onInsertSnippet, onInsertTemplate, onOpenTemplates, onSelectHeading, onSetMode, onToggleSidebar]);

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allItems.slice(0, 30);
    return allItems.filter((item) => {
      return (
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.badge && item.badge.toLowerCase().includes(q)) ||
        item.kind.toLowerCase().includes(q)
      );
    }).slice(0, 40);
  }, [allItems, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filteredItems[selectedIndex];
      if (selected) selected.action();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div
        className="palette-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command and Navigation Palette"
      >
        <div className="palette-search-box">
          <span className="palette-search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="palette-search-input"
            placeholder="Type a command, heading, task, or template..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="palette-close-btn" onClick={onClose}>Esc</button>
        </div>

        <div className="palette-results-list" role="listbox">
          {filteredItems.length === 0 ? (
            <div className="palette-empty-hint">No matching commands or sections</div>
          ) : (
            filteredItems.map((item, idx) => (
              <div
                key={item.id}
                className={`palette-item ${idx === selectedIndex ? "selected" : ""}`}
                onClick={item.action}
                role="option"
                aria-selected={idx === selectedIndex}
              >
                <div className="palette-item-content">
                  <div className="palette-item-title-row">
                    <span className="palette-item-title">{item.title}</span>
                    {item.badge ? <span className={`palette-badge badge-${item.kind}`}>{item.badge}</span> : null}
                  </div>
                  {item.subtitle ? <div className="palette-item-subtitle">{item.subtitle}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
