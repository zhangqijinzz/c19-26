import type { FieldSize } from '../../types';

/** 缩放下限（相对“适配视口”的比例），再小就没有编辑意义 */
export const MIN_ZOOM = 0.5;
/** 缩放上限：放大约 6 倍，足够看清最小展位的边界 */
export const MAX_ZOOM = 6;

/** 适配视口时场地四周预留的内边距（屏幕像素） */
export const FIT_PADDING = 36;
/** 平移到极限时，场地边缘至少要保留在屏幕内的可见宽度（屏幕像素） */
export const MIN_EDGE_VISIBLE = 56;

export interface ViewTransform {
  /** 相对适配比例的缩放倍数，1 即工具栏显示的 100% */
  zoom: number;
  /** 视口左上角对应的世界坐标（米） */
  panX: number;
  panY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 让整块场地适配视口的「米 → 像素」换算比例 */
export const calculateFitScale = (field: FieldSize, viewport: ViewportSize): number => {
  if (field.width <= 0 || field.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(
    (viewport.width - FIT_PADDING * 2) / field.width,
    (viewport.height - FIT_PADDING * 2) / field.height,
  );
};

/** 让场地居中显示时，视口左上角对应的世界坐标 */
export const centeredPan = (field: FieldSize, ppm: number, viewport: ViewportSize): { x: number; y: number } => ({
  x: (field.width - viewport.width / ppm) / 2,
  y: (field.height - viewport.height / ppm) / 2,
});

/**
 * 限制单轴平移范围：场地不允许被拖出视口，
 * 边缘始终保留 MIN_EDGE_VISIBLE 像素可见。
 */
const clampAxisPan = (pan: number, fieldSize: number, viewportSize: number, ppm: number): number => {
  const visible = MIN_EDGE_VISIBLE / ppm;
  const span = viewportSize / ppm;
  if (fieldSize <= span) {
    // 场地比视口窄：禁止平移，始终居中
    return (fieldSize - span) / 2;
  }
  // pan 表示视口左边缘对应的世界坐标：最左能看到场地左侧以外一点，
  // 最右仍需保留一段场地在视口内。
  return clamp(pan, -visible, fieldSize - span + visible);
};

/** 按当前视口与场地尺寸约束平移，避免平面图被拖到完全看不见 */
export const clampPan = (
  pan: { x: number; y: number },
  field: FieldSize,
  ppm: number,
  viewport: ViewportSize,
): { x: number; y: number } => ({
  x: clampAxisPan(pan.x, field.width, viewport.width, ppm),
  y: clampAxisPan(pan.y, field.height, viewport.height, ppm),
});

/**
 * 围绕某个视口锚点缩放，缩放前后锚点指向同一个世界坐标，
 * 缩放倍数会被夹在上下限内。
 */
export const zoomAtPoint = (
  view: ViewTransform,
  factor: number,
  anchor: { x: number; y: number },
  field: FieldSize,
  fitScale: number,
  viewport: ViewportSize,
): ViewTransform => {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === view.zoom) return view;
  const beforePpm = fitScale * view.zoom;
  const ppm = fitScale * zoom;
  const worldX = view.panX + anchor.x / beforePpm;
  const worldY = view.panY + anchor.y / beforePpm;
  const pan = clampPan({ x: worldX - anchor.x / ppm, y: worldY - anchor.y / ppm }, field, ppm, viewport);
  return { zoom, panX: pan.x, panY: pan.y };
};

/** 恢复 100%（适配场地）视图 */
export const resetView = (field: FieldSize, fitScale: number, viewport: ViewportSize): ViewTransform => {
  const pan = centeredPan(field, fitScale, viewport);
  return { zoom: 1, panX: pan.x, panY: pan.y };
};

/** 每米对应的屏幕像素数 */
export const pixelsPerMeter = (fitScale: number, zoom: number) => fitScale * zoom;

/** 屏幕坐标（相对视口）→ 场地世界坐标（米），保证拖放指针落点无偏差 */
export const screenToWorld = (
  point: { x: number; y: number },
  view: ViewTransform,
  ppm: number,
): { x: number; y: number } => ({
  x: view.panX + point.x / ppm,
  y: view.panY + point.y / ppm,
});

/** 场地世界坐标（米）→ 屏幕坐标（相对视口），标尺/网格/路径共用同一套换算 */
export const worldToScreen = (
  point: { x: number; y: number },
  view: ViewTransform,
  ppm: number,
): { x: number; y: number } => ({
  x: (point.x - view.panX) * ppm,
  y: (point.y - view.panY) * ppm,
});

const STEP_CANDIDATES = [0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * 选出最接近目标屏幕间距的“整齐”刻度步长（米），
 * 放大后刻度自动加密、缩小时自动变疏。
 */
export const pickStep = (ppm: number, targetPixels: number): number => {
  const targetMeters = targetPixels / ppm;
  return STEP_CANDIDATES.find((step) => step >= targetMeters) ?? STEP_CANDIDATES[STEP_CANDIDATES.length - 1];
};

/** 标尺主刻度：约 64px 一档 */
export const rulerStep = (ppm: number): number => pickStep(ppm, 64);

/**
 * 网格步长始终取标尺主刻度的一半（主刻度本身仍在 1-2-5 数列上，
 * 一半也整齐），保证每条标尺主刻度都落在网格线上。
 */
export const gridStep = (ppm: number): number => rulerStep(ppm) / 2;

/** 生成 [start, end] 之间对齐到步长的刻度序列 */
export const tickValues = (start: number, end: number, step: number): number[] => {
  const values: number[] = [];
  const first = Math.ceil(start / step) * step;
  for (let value = first; value <= end + step / 1000; value += step) {
    values.push(Number(value.toFixed(3)));
  }
  return values;
};
