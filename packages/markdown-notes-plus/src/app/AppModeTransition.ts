export type AppMode = "writing" | "split" | "source" | "mindmap";

/** Fallback text can only be resolved by an explicit Source edit or initialize. */
export function modeAfterRequest(mode: AppMode, hasFallback: boolean): AppMode {
  return hasFallback && mode !== "source" ? "source" : mode;
}
