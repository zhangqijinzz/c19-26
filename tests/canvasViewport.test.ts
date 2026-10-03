import { describe, expect, it } from 'vitest';
import {
  baseScaleFor,
  clampView,
  fitView,
  niceStep,
  panBy,
  screenToMeters,
  topRulerTicks,
  zoomAtPoint,
  EDGE_KEEP,
  MAX_ZOOM,
  MIN_ZOOM,
} from '../src/features/layout-editor/canvasViewport';
import type { FieldSize } from '../src/types';
import type { ViewSize, ViewState } from '../src/features/layout-editor/canvasViewport';

const FIELD: FieldSize = { width: 28, height: 18 };
const VIEWPORT: ViewSize = { width: 800, height: 470 };

const base = () => baseScaleFor(FIELD, VIEWPORT);

describe('fitView', () => {
  it('centers the field at zoom 1 and keeps it inside the viewport', () => {
    const view = fitView(FIELD, VIEWPORT);
    expect(view.zoom).toBe(1);
    const scale = base();
    const worldWidth = FIELD.width * scale;
    const worldHeight = FIELD.height * scale;
    expect(worldWidth).toBeLessThanOrEqual(VIEWPORT.width - 52);
    expect(worldHeight).toBeLessThanOrEqual(VIEWPORT.height - 52);
    expect(view.centerX).toBe(VIEWPORT.width / 2);
    expect(view.centerY).toBe(VIEWPORT.height / 2);
  });
});

describe('screenToMeters', () => {
  it('maps screen points through fit scale', () => {
    const view = fitView(FIELD, VIEWPORT);
    const b = base();
    const worldWidth = FIELD.width * b;
    const leftEdge = view.centerX - worldWidth / 2;
    expect(screenToMeters(leftEdge, 0, view, FIELD, b).x).toBeCloseTo(0, 6);
    expect(screenToMeters(leftEdge + worldWidth, 0, view, FIELD, b).x).toBeCloseTo(FIELD.width, 6);
  });

  it('round-trips zoomed and panned coordinates', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const zoomed = zoomAtPoint(fitted, 3, 400, 200, FIELD, base(), VIEWPORT);
    const meter = { x: 12, y: 7 };
    const scale = base() * zoomed.zoom;
    const screenX = zoomed.centerX - (FIELD.width * scale) / 2 + meter.x * scale;
    const screenY = zoomed.centerY - (FIELD.height * scale) / 2 + meter.y * scale;
    const back = screenToMeters(screenX, screenY, zoomed, FIELD, base());
    expect(back.x).toBeCloseTo(meter.x, 6);
    expect(back.y).toBeCloseTo(meter.y, 6);
  });
});

describe('zoomAtPoint', () => {
  it('keeps the meter point under the cursor fixed while zooming', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const anchor = { x: 520, y: 300 };
    const before = screenToMeters(anchor.x, anchor.y, fitted, FIELD, base());
    const zoomed = zoomAtPoint(fitted, 2.5, anchor.x, anchor.y, FIELD, base(), VIEWPORT);
    const after = screenToMeters(anchor.x, anchor.y, zoomed, FIELD, base());
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps zoom to the configured limits', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    expect(zoomAtPoint(fitted, 100, 400, 200, FIELD, base(), VIEWPORT).zoom).toBe(MAX_ZOOM);
    expect(zoomAtPoint(fitted, 0.01, 400, 200, FIELD, base(), VIEWPORT).zoom).toBe(MIN_ZOOM);
  });
});

describe('clampView / panBy boundaries', () => {
  it('never allows the field to be dragged fully out of view', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    // 放大到场地比视口更宽/更高后，才会产生可平移空间。
    const zoomed = zoomAtPoint(fitted, 1.6, 400, 235, FIELD, base(), VIEWPORT);
    const worldWidth = FIELD.width * base() * zoomed.zoom;
    const worldHeight = FIELD.height * base() * zoomed.zoom;
    expect(worldWidth).toBeGreaterThan(VIEWPORT.width);
    const dragged = panBy(zoomed, 5000, 5000, FIELD, base(), VIEWPORT);
    // 向右/下拖到极限时，场地的左/上边缘停在距视口右/下边缘 EDGE_KEEP 处。
    expect(dragged.centerX - worldWidth / 2).toBeCloseTo(VIEWPORT.width - EDGE_KEEP, 5);
    expect(dragged.centerY - worldHeight / 2).toBeCloseTo(VIEWPORT.height - EDGE_KEEP, 5);
  });

  it('keeps an edge margin when panning the opposite direction too', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const zoomed = zoomAtPoint(fitted, 1.6, 400, 235, FIELD, base(), VIEWPORT);
    const worldWidth = FIELD.width * base() * zoomed.zoom;
    const worldHeight = FIELD.height * base() * zoomed.zoom;
    const dragged = panBy(zoomed, -5000, -5000, FIELD, base(), VIEWPORT);
    // 向左/上拖到极限时，场地的右/下边缘停在 EDGE_KEEP 处。
    expect(dragged.centerX + worldWidth / 2).toBeCloseTo(EDGE_KEEP, 5);
    expect(dragged.centerY + worldHeight / 2).toBeCloseTo(EDGE_KEEP, 5);
  });

  it('centers the field whenever it fits completely inside the viewport', () => {
    const b = base();
    const zoom = (704 / FIELD.width) / b * 0.95;
    expect(FIELD.width * b * zoom).toBeLessThanOrEqual(VIEWPORT.width);
    expect(FIELD.height * b * zoom).toBeLessThanOrEqual(VIEWPORT.height);
    const offCenter: ViewState = { zoom, centerX: 100, centerY: 400 };
    const clamped = clampView(offCenter, FIELD, b, VIEWPORT);
    expect(clamped.centerX).toBe(VIEWPORT.width / 2);
    expect(clamped.centerY).toBe(VIEWPORT.height / 2);
  });

  it('still allows panning to corners at maximum zoom', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const maxed = zoomAtPoint(fitted, MAX_ZOOM, 400, 235, FIELD, base(), VIEWPORT);
    const totalScale = base() * MAX_ZOOM;
    expect(FIELD.width * totalScale).toBeGreaterThan(VIEWPORT.width);
    const draggedTopLeft = panBy(maxed, -5000, -5000, FIELD, base(), VIEWPORT);
    // 左/上角落能拖到右/下边缘距视口 EDGE_KEEP 的位置，而不是被钉在中心。
    expect(draggedTopLeft.centerX + (FIELD.width * totalScale) / 2).toBeCloseTo(EDGE_KEEP, 4);
    expect(draggedTopLeft.centerY + (FIELD.height * totalScale) / 2).toBeCloseTo(EDGE_KEEP, 4);
    const draggedBottomRight = panBy(maxed, 5000, 5000, FIELD, base(), VIEWPORT);
    expect(draggedBottomRight.centerX - (FIELD.width * totalScale) / 2).toBeCloseTo(VIEWPORT.width - EDGE_KEEP, 4);
    expect(draggedBottomRight.centerY - (FIELD.height * totalScale) / 2).toBeCloseTo(VIEWPORT.height - EDGE_KEEP, 4);
  });
});

describe('niceStep and ruler ticks', () => {
  it('returns a 1/2/5 power-of-ten step near 48px at fit zoom', () => {
    const step = niceStep(base(), 1);
    const pixels = step * base();
    expect(pixels).toBeGreaterThanOrEqual(24);
    expect(pixels).toBeLessThan(120);
    expect([1, 2, 5]).toContain(step / 10 ** Math.floor(Math.log10(step)));
  });

  it('aligns the tick at meter 0 with the left edge of the field after panning', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const panned = panBy(fitted, 120, 0, FIELD, base(), VIEWPORT);
    const ticks = topRulerTicks(panned, FIELD, base(), VIEWPORT);
    const zero = ticks.find((tick) => tick.value === 0);
    expect(zero).toBeDefined();
    const scale = base();
    const fieldLeft = panned.centerX - (FIELD.width * scale) / 2;
    expect(zero!.position).toBeCloseTo(fieldLeft, 5);
  });

  it('marks ticks outside the field bounds', () => {
    const fitted = fitView(FIELD, VIEWPORT);
    const ticks = topRulerTicks(fitted, FIELD, base(), VIEWPORT);
    const negative = ticks.find((tick) => tick.value < 0);
    if (negative) expect(negative.inBounds).toBe(false);
    const inside = ticks.find((tick) => tick.value === 0);
    expect(inside?.inBounds).toBe(true);
  });
});
