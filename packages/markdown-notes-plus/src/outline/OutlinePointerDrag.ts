export const OUTLINE_DRAG_HOLD_MS = 250;
export const OUTLINE_DRAG_MOVE_TOLERANCE_PX = 10;

export function isOutlineDragPointer(pointerId: number, eventPointerId: number): boolean {
  return pointerId === eventPointerId;
}

export function outlineDropPlacement(clientY: number, rect: { top: number; height: number }): "before" | "after" {
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

export function captureOutlinePointer(handle: { setPointerCapture: (pointerId: number) => void }, pointerId: number): boolean {
  try {
    handle.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

type Timer = {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

/** Long-press gate for outline drag. Pending movement beyond the tolerance cancels it. */
export function createOutlineDragActivationGate(
  setTimeoutImpl: Timer["setTimeout"],
  clearTimeoutImpl: Timer["clearTimeout"],
) {
  let startX = 0;
  let startY = 0;
  let timerId: number | undefined;
  let started = false;
  let activated = false;
  let activate: () => void = () => undefined;
  let cancel: () => void = () => undefined;

  const up = () => {
    if (!started) return;
    if (timerId !== undefined) {
      clearTimeoutImpl(timerId);
      timerId = undefined;
    }
    if (!activated) {
      activated = true;
      cancel();
    }
  };

  return {
    onActivate(fn: () => void) { activate = fn; },
    onCancel(fn: () => void) { cancel = fn; },
    start(x: number, y: number) {
      startX = x;
      startY = y;
      started = true;
      activated = false;
      timerId = setTimeoutImpl(() => {
        timerId = undefined;
        activated = true;
        activate();
      }, OUTLINE_DRAG_HOLD_MS);
    },
    move(x: number, y: number) {
      if (activated || timerId === undefined) return;
      if (Math.abs(x - startX) > OUTLINE_DRAG_MOVE_TOLERANCE_PX || Math.abs(y - startY) > OUTLINE_DRAG_MOVE_TOLERANCE_PX) up();
    },
    up,
  };
}

/** Find an outline row anchor under a viewport point inside the supplied list. */
export function outlineRowAnchorAtPoint(x: number, y: number, container: ParentNode): number | undefined {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest?.(".outline-row");
  if (!row || !container.contains(row)) return undefined;
  const anchor = Number((row as HTMLElement).dataset.anchor);
  return Number.isFinite(anchor) ? anchor : undefined;
}
