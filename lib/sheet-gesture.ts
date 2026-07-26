// Pure gesture-decision math for the day-detail bottom sheet (#24).
// Convention: dy is downward px travel — positive = toward dismiss; the
// sheet rests fully open at dy = 0. No DOM, no React (unit-tested).

/**
 * Diminishing-returns resistance for dragging PAST the open detent (upward).
 * `offset` is the past-bounds magnitude (px, >= 0). Returns a damped magnitude
 * that is always < offset and saturates toward `dim` (iOS-style rubber band).
 */
export function rubberBand(offset: number, dim: number, c = 0.55): number {
  if (offset <= 0) return offset;
  return (1 - 1 / ((offset / dim) * c + 1)) * dim;
}

/** Should the sheet dismiss on release? Past the distance ratio OR a fast flick. */
export function shouldDismiss(opts: {
  dy: number;
  sheetHeight: number;
  velocity: number; // px/ms, positive = downward
  distanceRatio?: number;
  flickVelocity?: number;
}): boolean {
  const { dy, sheetHeight, velocity, distanceRatio = 0.35, flickVelocity = 0.5 } = opts;
  if (dy <= 0) return false;
  return dy > sheetHeight * distanceRatio || velocity > flickVelocity;
}

/** Scrim coupling: 1 at fully-open (dy=0), 0 at fully-dragged-down. Clamped. */
export function scrimProgress(dy: number, sheetHeight: number): number {
  if (sheetHeight <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - dy / sheetHeight));
}

const HANDLE_SLOP = 2; // px of jitter tolerated before a handle pull is a drag
const BODY_SLOP = 4; // px of downward travel before a body pull takes over from scroll

/**
 * Does this pointer gesture belong to the SHEET (drag-to-dismiss) or to the card's
 * native scroll? A pull that starts on the grabber is always the sheet's — the
 * grabber is the sheet's handle, not content, so it wins in either direction and
 * regardless of scroll position. Anywhere else, only a downward pull with the list
 * already at the top takes over (#24's original rule, unchanged).
 */
export function claimsSheetDrag(opts: {
  dy: number; // px since pointerdown, positive = downward
  fromHandle: boolean; // pointerdown landed on the grabber
  scrollTop: number; // the card's scroll offset
}): boolean {
  const { dy, fromHandle, scrollTop } = opts;
  if (fromHandle) return Math.abs(dy) > HANDLE_SLOP;
  return dy > BODY_SLOP && scrollTop <= 0;
}
