import type { FieldSize } from '../../types';

/** 纯函数的平面图视口计算：适配、缩放、平移、坐标换算、标尺刻度。 */

export interface ViewSize {
  width: number;
  height: number;
}

export interface ViewState {
  /** 相对“适配视图”的倍数：1 表示整图适配，2 表示再放大一倍。 */
  zoom: number;
  /** 视口坐标内场地中心的位置（CSS 像素）。 */
  centerX: number;
  centerY: number;
}

export interface RulerTick {
  /** 刻度对应的场地坐标（米）。 */
  value: number;
  /** 刻度在视口内的像素位置。 */
  position: number;
  major: boolean;
  inBounds: boolean;
}

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 8;
/** 缩放到极限时，场地边缘至少要留在视口里的像素，避免整张图被拖没。 */
export const EDGE_KEEP = 48;
export const VIEWPORT_PADDING = 26;

/** 适配比例下，1 米对应多少屏幕像素（基准缩放）。 */
export const baseScaleFor = (field: FieldSize, viewport: ViewSize): number => {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  const availableWidth = viewport.width - VIEWPORT_PADDING * 2;
  const availableHeight = viewport.height - VIEWPORT_PADDING * 2;
  return Math.max(0.01, Math.min(availableWidth / field.width, availableHeight / field.height));
};

export const worldSizeFor = (field: FieldSize, baseScale: number, zoom: number): ViewSize => ({
  width: field.width * baseScale * zoom,
  height: field.height * baseScale * zoom,
});

/** 整图适配：场地居中，zoom 回到 1（工具栏显示 100%）。 */
export const fitView = (field: FieldSize, viewport: ViewSize): ViewState => ({
  zoom: 1,
  centerX: viewport.width / 2,
  centerY: viewport.height / 2,
});

const clampCenter = (value: number, worldSpan: number, viewportSpan: number): number => {
  // 场地能完整放进视口时钉在中央，不留下可拖的空白边。
  if (worldSpan <= viewportSpan) return viewportSpan / 2;
  // 场地比视口大：向左拖到极限时右边缘停在 EDGE_KEEP，向右拖到极限时左边缘停在 V-EDGE_KEEP。
  const lower = EDGE_KEEP - worldSpan / 2;
  const upper = viewportSpan - EDGE_KEEP + worldSpan / 2;
  return Math.min(upper, Math.max(lower, value));
};

/** 把平移状态限制在“场地始终可见一圈”的边界内。 */
export const clampView = (view: ViewState, field: FieldSize, baseScale: number, viewport: ViewSize): ViewState => {
  const world = worldSizeFor(field, baseScale, view.zoom);
  return {
    zoom: view.zoom,
    centerX: clampCenter(view.centerX, world.width, viewport.width),
    centerY: clampCenter(view.centerY, world.height, viewport.height),
  };
};

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** 以视口内某点（通常是光标）为锚点缩放，锚点下的场地坐标保持不动。 */
export const zoomAtPoint = (
  view: ViewState,
  nextZoomInput: number,
  anchorX: number,
  anchorY: number,
  field: FieldSize,
  baseScale: number,
  viewport: ViewSize,
): ViewState => {
  const zoom = clampZoom(nextZoomInput);
  if (zoom === view.zoom) return view;
  const ratio = zoom / view.zoom;
  // 保持锚点对应的世界位置不变：(anchor - nextCenter) = ratio * (anchor - center)
  return clampView({
    zoom,
    centerX: anchorX - (anchorX - view.centerX) * ratio,
    centerY: anchorY - (anchorY - view.centerY) * ratio,
  }, field, baseScale, viewport);
};

/** 拖动空白处平移，并做边界限制。 */
export const panBy = (view: ViewState, deltaX: number, deltaY: number, field: FieldSize, baseScale: number, viewport: ViewSize): ViewState =>
  clampView({ ...view, centerX: view.centerX + deltaX, centerY: view.centerY + deltaY }, field, baseScale, viewport);

/** 屏幕像素 -> 场地米。元素拖动落点换算全走这里，保证缩放后指针与元素位置不偏。 */
export const screenToMeters = (
  screenX: number,
  screenY: number,
  view: ViewState,
  field: FieldSize,
  baseScale: number,
): { x: number; y: number } => {
  const scale = baseScale * view.zoom;
  return {
    x: (screenX - (view.centerX - (field.width * scale) / 2)) / scale,
    y: (screenY - (view.centerY - (field.height * scale) / 2)) / scale,
  };
};

/** 当前视口覆盖到的场地范围（米），供标尺刻度裁剪使用。 */
export const visibleMeterRange = (view: ViewState, field: FieldSize, baseScale: number, viewport: ViewSize) => {
  const topLeft = screenToMeters(0, 0, view, field, baseScale);
  const bottomRight = screenToMeters(viewport.width, viewport.height, view, field, baseScale);
  return { fromX: topLeft.x, toX: bottomRight.x, fromY: topLeft.y, toY: bottomRight.y };
};

/** 选出“好看”的刻度步长（1 / 2 / 5 × 10^n），让相邻主刻度约 48px。 */
export const niceStep = (baseScale: number, zoom: number, targetPixels = 48): number => {
  const metersPerTarget = targetPixels / (baseScale * zoom);
  const exponent = Math.floor(Math.log10(metersPerTarget));
  const fraction = metersPerTarget / 10 ** exponent;
  const candidate = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1;
  return candidate * 10 ** exponent;
};

const buildTicks = (
  visibleFrom: number,
  visibleTo: number,
  fieldSpan: number,
  view: ViewState,
  field: FieldSize,
  baseScale: number,
  axis: 'x' | 'y',
): RulerTick[] => {
  const step = niceStep(baseScale, view.zoom);
  const minor = step / 2;
  const start = Math.floor(visibleFrom / minor) * minor;
  const ticks: RulerTick[] = [];
  const scale = baseScale * view.zoom;
  const origin = axis === 'x'
    ? view.centerX - (field.width * scale) / 2
    : view.centerY - (field.height * scale) / 2;
  for (let value = start; value <= visibleTo + minor / 2; value += minor) {
    const rounded = Math.round(value * 1000) / 1000;
    const major = Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6;
    ticks.push({ value: rounded, position: origin + rounded * scale, major, inBounds: rounded >= -1e-6 && rounded <= fieldSpan + 1e-6 });
  }
  return ticks;
};

export const topRulerTicks = (view: ViewState, field: FieldSize, baseScale: number, viewport: ViewSize): RulerTick[] => {
  const range = visibleMeterRange(view, field, baseScale, viewport);
  return buildTicks(range.fromX, range.toX, field.width, view, field, baseScale, 'x');
};

export const sideRulerTicks = (view: ViewState, field: FieldSize, baseScale: number, viewport: ViewSize): RulerTick[] => {
  const range = visibleMeterRange(view, field, baseScale, viewport);
  return buildTicks(range.fromY, range.toY, field.height, view, field, baseScale, 'y');
};

export const formatTick = (value: number): string => {
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return value.toFixed(1);
};
