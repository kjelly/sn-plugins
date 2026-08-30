export const WRITING_COMMANDS = [
  "heading",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "bullet",
  "numbered",
  "task",
  "quote",
  "code",
  "table",
  "image",
  "link",
  "divider",
] as const;

export type WritingCommandName = typeof WRITING_COMMANDS[number];

export const COMMAND_ALIASES: Record<WritingCommandName, readonly string[]> = {
  heading: ["h1", "title"],
  heading2: ["h2", "subtitle"],
  heading3: ["h3", "subheading"],
  heading4: ["h4"],
  heading5: ["h5"],
  heading6: ["h6"],
  bullet: ["list", "bullet-list", "ul"],
  numbered: ["numbered-list", "ol"],
  task: ["todo", "checkbox", "check", "task-list"],
  quote: ["blockquote", "callout"],
  code: ["codeblock", "pre"],
  table: ["grid"],
  image: ["img", "photo", "picture"],
  link: ["url", "hyperlink"],
  divider: ["hr", "separator", "line"],
};

export type WritingCommandPlan =
  | { kind: "set-block-type"; nodeName: "heading" | "code_block"; attrs?: Record<string, unknown>; target: "current-block" }
  | { kind: "wrap"; nodeName: "bullet_list" | "ordered_list" | "blockquote"; attrs?: Record<string, unknown>; target: "selection" }
  | { kind: "task-list"; target: "selection" }
  | { kind: "link"; target: "selection-or-stored-mark" }
  | { kind: "replace-block"; nodeName: "table" | "hr"; target: "current-block" }
  | { kind: "replace-selection"; nodeName: "image"; attrs: Record<string, string>; target: "selection" };

/** Pure command intent used by both toolbar and slash dispatch. */
export function writingCommandPlan(command: WritingCommandName): WritingCommandPlan {
  switch (command) {
    case "heading": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 1 }, target: "current-block" };
    case "heading2": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 2 }, target: "current-block" };
    case "heading3": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 3 }, target: "current-block" };
    case "heading4": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 4 }, target: "current-block" };
    case "heading5": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 5 }, target: "current-block" };
    case "heading6": return { kind: "set-block-type", nodeName: "heading", attrs: { level: 6 }, target: "current-block" };
    case "bullet": return { kind: "wrap", nodeName: "bullet_list", target: "selection" };
    case "numbered": return { kind: "wrap", nodeName: "ordered_list", attrs: { order: 1 }, target: "selection" };
    case "task": return { kind: "task-list", target: "selection" };
    case "link": return { kind: "link", target: "selection-or-stored-mark" };
    case "quote": return { kind: "wrap", nodeName: "blockquote", target: "selection" };
    case "code": return { kind: "set-block-type", nodeName: "code_block", attrs: { language: "" }, target: "current-block" };
    case "table": return { kind: "replace-block", nodeName: "table", target: "current-block" };
    case "image": return { kind: "replace-selection", nodeName: "image", attrs: { src: "https://", alt: "alt text", title: "" }, target: "selection" };
    case "divider": return { kind: "replace-block", nodeName: "hr", target: "current-block" };
  }
}
