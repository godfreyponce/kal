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
