export interface HorizontalScrollContainer {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
}

export interface ToolbarWheelInput {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

const LINE_HEIGHT_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * Converts a vertical mouse-wheel gesture over an overflowing toolbar into
 * horizontal scrolling. Returns true only when the toolbar consumed the input.
 */
export function scrollToolbarWithWheel(container: HorizontalScrollContainer, event: ToolbarWheelInput): boolean {
  // Ctrl + wheel is commonly browser zoom or trackpad pinch-zoom.
  if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    return false;
  }

  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  if (maxScrollLeft === 0) return false;

  const unit = event.deltaMode === DOM_DELTA_LINE
    ? LINE_HEIGHT_PX
    : event.deltaMode === DOM_DELTA_PAGE
      ? container.clientWidth
      : 1;
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, container.scrollLeft + event.deltaY * unit));
  if (nextScrollLeft === container.scrollLeft) return false;

  container.scrollLeft = nextScrollLeft;
  return true;
}
