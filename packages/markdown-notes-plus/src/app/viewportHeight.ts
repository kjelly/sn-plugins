export function computeViewportHeightCss(height: number): string | undefined {
  return height > 0 ? `${height}px` : undefined;
}
