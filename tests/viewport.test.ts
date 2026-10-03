import { describe, expect, it } from 'vitest';
import {
  calculateFitScale,
  clampPan,
  gridStep,
  MAX_ZOOM,
  MIN_EDGE_VISIBLE,
  MIN_ZOOM,
  pixelsPerMeter,
  resetView,
  rulerStep,
  screenToWorld,
  tickValues,
  worldToScreen,
  zoomAtPoint,
  type ViewTransform,
} from '../src/features/layout-editor/viewport';
const FIELD = { width: 60, height: 40 };
const VIEWPORT = { width: 800, height: 500 };
const fitScale = calculateFitScale(FIELD, VIEWPORT);
// (800-72)/60 = 12.133；(500-72)/40 = 10.7
const expectedFit = 10.7;

describe('calculateFitScale', () => {
  it('fits the whole field inside the viewport with padding', () => {
    expect(fitScale).toBeCloseTo(expectedFit, 5);
    expect(FIELD.width * fitScale + 72).toBeLessThanOrEqual(VIEWPORT.width);
    expect(FIELD.height * fitScale + 72).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('defaults to 100% view centered on the field', () => {
    const view = resetView(FIELD, fitScale, VIEWPORT);
    expect(view.zoom).toBe(1);
    const centerScreen = worldToScreen({ x: FIELD.width / 2, y: FIELD.height / 2 }, view, fitScale);
    expect(centerScreen.x).toBeCloseTo(VIEWPORT.width / 2, 5);
    expect(centerScreen.y).toBeCloseTo(VIEWPORT.height / 2, 5);
  });
});

describe('zoomAtPoint', () => {
  const initial: ViewTransform = { zoom: 1, panX: 0, panY: 0 };

  it('keeps the world point under the cursor anchored while zooming', () => {
    const anchor = { x: 240, y: 150 };
    const before = screenToWorld(anchor, initial, pixelsPerMeter(fitScale, 1));
    const zoomed = zoomAtPoint(initial, 2, anchor, FIELD, fitScale, VIEWPORT);
    const after = screenToWorld(anchor, zoomed, pixelsPerMeter(fitScale, zoomed.zoom));
    expect(zoomed.zoom).toBeCloseTo(2, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('clamps zoom to the configured limits', () => {
    const anchor = { x: 400, y: 250 };
    const maxed = zoomAtPoint({ ...initial, zoom: MAX_ZOOM }, 10, anchor, FIELD, fitScale, VIEWPORT);
    expect(maxed.zoom).toBe(MAX_ZOOM);
    const mined = zoomAtPoint({ ...initial, zoom: MIN_ZOOM }, 0.01, anchor, FIELD, fitScale, VIEWPORT);
    expect(mined.zoom).toBe(MIN_ZOOM);
  });

  it('returns the same view when the factor cannot change zoom past a limit', () => {
    const atMax: ViewTransform = { ...initial, zoom: MAX_ZOOM };
    expect(zoomAtPoint(atMax, 2, { x: 10, y: 10 }, FIELD, fitScale, VIEWPORT)).toBe(atMax);
  });
});

describe('clampPan', () => {
  it('never lets the field edge move fully outside the viewport', () => {
    const ppm = pixelsPerMeter(fitScale, 2);
    const pan = clampPan({ x: -9999, y: -9999 }, FIELD, ppm, VIEWPORT);
    expect(pan.x).toBeCloseTo(-MIN_EDGE_VISIBLE / ppm, 5);
    expect(pan.y).toBeCloseTo(-MIN_EDGE_VISIBLE / ppm, 5);
    const far = clampPan({ x: 9999, y: 9999 }, FIELD, ppm, VIEWPORT);
    expect(far.x).toBeCloseTo(FIELD.width - VIEWPORT.width / ppm + MIN_EDGE_VISIBLE / ppm, 5);
    expect(far.y).toBeCloseTo(FIELD.height - VIEWPORT.height / ppm + MIN_EDGE_VISIBLE / ppm, 5);
  });

  it('locks the axis centered and ignores pan when the field is smaller than the viewport', () => {
    const smallField = { width: 10, height: 8 };
    const pan = clampPan({ x: 3, y: 2 }, smallField, fitScale, VIEWPORT);
    expect(pan.x).toBeCloseTo((smallField.width - VIEWPORT.width / fitScale) / 2, 5);
    expect(pan.y).toBeCloseTo((smallField.height - VIEWPORT.height / fitScale) / 2, 5);
  });

  it('keeps a valid pan unchanged', () => {
    const ppm = pixelsPerMeter(fitScale, 3);
    const pan = clampPan({ x: 5, y: 4 }, FIELD, ppm, VIEWPORT);
    expect(pan).toEqual({ x: 5, y: 4 });
  });
});

describe('coordinate conversion round trip', () => {
  it('maps screen points back to the exact world location at any zoom', () => {
    const view: ViewTransform = { zoom: 2.4, panX: 12.5, panY: 7.25 };
    const ppm = pixelsPerMeter(fitScale, view.zoom);
    const world = { x: 30, y: 20 };
    const screen = worldToScreen(world, view, ppm);
    expect(screenToWorld(screen, view, ppm)).toEqual(world);
  });
});

describe('ruler and grid steps', () => {
  it('denser steps at higher zoom and coarser steps when zoomed out', () => {
    const far = gridStep(pixelsPerMeter(fitScale, MIN_ZOOM));
    const near = gridStep(pixelsPerMeter(fitScale, MAX_ZOOM));
    expect(near).toBeLessThan(far);
  });

  it('keeps grid lines aligned with ruler major and minor ticks at any zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.8, 1, 1.6, 3, MAX_ZOOM]) {
      const ppm = pixelsPerMeter(fitScale, zoom);
      const major = rulerStep(ppm);
      const grid = gridStep(ppm);
      expect(major / grid).toBe(2);
      expect(Number((major / grid).toFixed(6)) % 1).toBe(0);
    }
  });

  it('emits ticks aligned exactly to the step, including 0', () => {
    const ticks = tickValues(-0.4, 10.2, 2);
    expect(ticks[0]).toBe(0);
    expect(ticks).toEqual([0, 2, 4, 6, 8, 10]);
  });
});
