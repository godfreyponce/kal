import { describe, it, expect } from "vitest";
import { rubberBand, shouldDismiss, scrimProgress } from "./sheet-gesture";

describe("rubberBand", () => {
  it("returns 0 at the boundary", () => {
    expect(rubberBand(0, 600)).toBe(0);
  });
  it("damps: output is always less than the raw offset past the boundary", () => {
    expect(rubberBand(100, 600)).toBeLessThan(100);
    expect(rubberBand(300, 600)).toBeLessThan(300);
  });
  it("is monotonic increasing in offset", () => {
    expect(rubberBand(200, 600)).toBeGreaterThan(rubberBand(100, 600));
  });
  it("saturates below the sheet height no matter how far you pull", () => {
    expect(rubberBand(100000, 600)).toBeLessThan(600);
  });
  it("a smaller factor resists harder", () => {
    expect(rubberBand(200, 600, 0.3)).toBeLessThan(rubberBand(200, 600, 0.8));
  });
});

describe("shouldDismiss", () => {
  const H = 600;
  it("does not dismiss a small, slow drag", () => {
    expect(shouldDismiss({ dy: 80, sheetHeight: H, velocity: 0.1 })).toBe(false);
  });
  it("dismisses once dragged past the distance ratio", () => {
    expect(shouldDismiss({ dy: 0.4 * H, sheetHeight: H, velocity: 0 })).toBe(true);
  });
  it("dismisses a short but fast downward flick", () => {
    expect(shouldDismiss({ dy: 40, sheetHeight: H, velocity: 1.2 })).toBe(true);
  });
  it("never dismisses on an upward drag", () => {
    expect(shouldDismiss({ dy: -200, sheetHeight: H, velocity: -2 })).toBe(false);
  });
});

describe("scrimProgress", () => {
  it("is 1 when the sheet is fully open", () => {
    expect(scrimProgress(0, 600)).toBe(1);
  });
  it("is 0 when dragged a full sheet-height down", () => {
    expect(scrimProgress(600, 600)).toBe(0);
  });
  it("clamps past the ends", () => {
    expect(scrimProgress(900, 600)).toBe(0);
    expect(scrimProgress(-50, 600)).toBe(1);
  });
});
