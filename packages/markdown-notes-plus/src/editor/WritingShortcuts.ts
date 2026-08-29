type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey"> & { isComposing?: boolean; shiftKey?: boolean };

export function isWritingLinkShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

export function isWritingBoldShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "b";
}

export function isWritingItalicShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "i";
}

export function isWritingStrikeShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && Boolean(event.shiftKey) && event.key.toLowerCase() === "x";
}

export function isWritingInlineCodeShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "e";
}
