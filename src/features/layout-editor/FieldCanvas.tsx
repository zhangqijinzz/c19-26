import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import type { LayoutMode, PathPreview, RenderElement } from '../../types';
import {
  baseScaleFor,
  clampView,
  fitView,
  formatTick,
  niceStep,
  panBy,
  screenToMeters,
  sideRulerTicks,
  topRulerTicks,
  zoomAtPoint,
  MAX_ZOOM,
  MIN_ZOOM,
  type ViewSize,
  type ViewState,
} from './canvasViewport';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedId: string | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}

export function FieldCanvas({ field, elements, selectedId, mode, overlaps, bounds, channels, path, onSelect, onMove }: FieldCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewSize>({ width: 0, height: 0 });
  const [view, setView] = useState<ViewState>({ zoom: 1, centerX: 0, centerY: 0 });
  const [panning, setPanning] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  // 让非 React 的原生事件（wheel）始终读到最新视口状态。
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; base: ViewState } | null>(null);

  const baseScale = baseScaleFor(field, viewport);
  const hasFitRef = useRef(false);

  // 测量视口尺寸；缩放/平移都基于它计算。
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 首次拿到尺寸时整图适配。
  useEffect(() => {
    if (!hasFitRef.current && viewport.width > 0 && viewport.height > 0) {
      hasFitRef.current = true;
      setView(fitView(field, viewport));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height]);

  // 场地尺寸变化（含首次载入存档）后恢复默认比例；视图状态不进存档。
  const fieldKey = `${field.width}x${field.height}`;
  const previousFieldKey = useRef(fieldKey);
  useEffect(() => {
    if (previousFieldKey.current !== fieldKey) {
      previousFieldKey.current = fieldKey;
      setView(fitView(field, viewport));
    }
  }, [fieldKey, field, viewport]);

  // 窗口缩放导致视口尺寸变化时，把视图重新夹回合法范围，避免平面图飘出可视区。
  const previousViewportRef = useRef<ViewSize>({ width: 0, height: 0 });
  useEffect(() => {
    const previous = previousViewportRef.current;
    previousViewportRef.current = viewport;
    if (previous.width === 0 || !hasFitRef.current) return;
    if (previous.width === viewport.width && previous.height === viewport.height) return;
    setView((current) => clampView(current, field, baseScaleFor(field, viewport), viewport));
  }, [viewport, field]);

  // Ctrl/⌘ + 滚轮以光标为锚点缩放；普通滚轮上下/左右平移；均带边界限制。
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const modeUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * modeUnit * 0.0012);
        setView((current) => zoomAtPoint(current, current.zoom * factor, anchorX, anchorY, field, baseScaleFor(field, { width: rect.width, height: rect.height }), { width: rect.width, height: rect.height }));
      } else {
        const deltaX = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0) * modeUnit * 0.8;
        const deltaY = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 0 : event.deltaY) * modeUnit * 0.8;
        setView((current) => panBy(current, -deltaX, -deltaY, field, baseScaleFor(field, { width: rect.width, height: rect.height }), { width: rect.width, height: rect.height }));
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [field]);

  const zoomWithButton = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => zoomAtPoint(current, current.zoom * factor, rect.width / 2, rect.height / 2, field, baseScale, viewport));
  };

  const resetView = useCallback(() => setView(fitView(field, viewport)), [field, viewport]);

  const issueIds = useMemo(() => new Set(overlaps.flatMap((item) => [item.firstId, item.secondId])), [overlaps]);
  const channelIds = useMemo(() => new Set(channels.flatMap((item) => [item.firstId, item.secondId])), [channels]);
  const boundsIds = useMemo(() => new Set(bounds.map((item) => item.elementId)), [bounds]);

  const pointFromEvent = (event: React.PointerEvent) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return screenToMeters(event.clientX - box.left, event.clientY - box.top, viewRef.current, field, baseScale);
  };

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 落在元素或场内装饰文字上的指针各有处理；其余空白区域都用于平移。
    const target = event.target as HTMLElement;
    if (target.closest('.canvas-element') || target.classList.contains('field-label') || target.classList.contains('axis-hint')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, base: viewRef.current };
    setPanning(true);
  };

  const onViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = panRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setView(panBy(gesture.base, event.clientX - gesture.startX, event.clientY - gesture.startY, field, baseScale, viewport));
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      setPanning(false);
    }
  };

  const scale = baseScale * view.zoom;
  const worldWidth = field.width * scale;
  const worldHeight = field.height * scale;
  const worldLeft = view.centerX - worldWidth / 2;
  const worldTop = view.centerY - worldHeight / 2;
  const gridStepPx = niceStep(baseScale, view.zoom) * scale;
  const zoomPercent = Math.round(view.zoom * 100);
  const topTicks = viewport.width > 0 ? topRulerTicks(view, field, baseScale, viewport) : [];
  const sideTicks = viewport.width > 0 ? sideRulerTicks(view, field, baseScale, viewport) : [];
  // 路径线宽/圆点在屏幕上保持恒定，缩放时只跟随锚点对齐不变形。
  const pathStrokeWidth = 0.3 / scale;
  const pathMarkerRadius = 0.45 / scale;
  const pathDash = `${0.75 / scale} ${0.55 / scale}`;

  return <section className="canvas-panel">
    <div className="canvas-toolbar">
      <div className="toolbar-title"><span className="tool-grid">▦</span><div><strong>展厅平面图</strong><small>比例 1 : 100 · 单位：米</small></div></div>
      <div className="toolbar-actions">
        <div className="zoom-controls" aria-label="平面图缩放">
          <button type="button" aria-label="缩小" onClick={() => zoomWithButton(1 / 1.25)} disabled={view.zoom <= MIN_ZOOM}>−</button>
          <button type="button" className="zoom-value" title="恢复整图适配" onClick={resetView}>{zoomPercent}%</button>
          <button type="button" aria-label="放大" onClick={() => zoomWithButton(1.25)} disabled={view.zoom >= MAX_ZOOM}>＋</button>
          <button type="button" className="zoom-fit" aria-label="重置视图" onClick={resetView}>适应</button>
        </div>
        <button type="button" aria-label="更多布局选项">•••</button>
      </div>
    </div>
    <div
      ref={viewportRef}
      className={`canvas-viewport mode-${mode}${panning ? ' is-panning' : ''}`}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="canvas-ruler top-ruler">
        {topTicks.filter((tick) => tick.major).map((tick) => <span key={`t-${tick.value}`} className={`ruler-tick ${tick.inBounds ? '' : 'is-outside'}`} style={{ left: `${tick.position}px` }}>{formatTick(tick.value)}</span>)}
      </div>
      <div className="canvas-ruler side-ruler">
        {sideTicks.filter((tick) => tick.major).map((tick) => <span key={`s-${tick.value}`} className={`ruler-tick ${tick.inBounds ? '' : 'is-outside'}`} style={{ top: `${tick.position}px` }}>{formatTick(tick.value)}</span>)}
      </div>
      <div className="ruler-corner" />
      <div
        className="field-world"
        style={{
          width: `${worldWidth}px`,
          height: `${worldHeight}px`,
          transform: `translate(${worldLeft}px, ${worldTop}px)`,
          ['--zoom' as string]: `${view.zoom}`,
        }}
      >
        <div className="field-canvas" style={{ backgroundSize: `${gridStepPx}px ${gridStepPx}px` }}>
          <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
          {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth={pathStrokeWidth} strokeDasharray={pathDash} /><circle cx={path.points[0].x} cy={path.points[0].y} r={pathMarkerRadius} fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r={pathMarkerRadius} fill="#ef795f" /></svg> : null}
          {elements.map((element) => {
            const spec = ELEMENT_SPECS[element.kind];
            const classes = ['canvas-element', selectedId === element.id ? 'is-selected' : '', issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '', channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '', boundsIds.has(element.id) ? 'is-out' : ''].filter(Boolean).join(' ');
            return <button key={element.id} type="button" className={classes} style={{ left: `${element.x / field.width * 100}%`, top: `${element.y / field.height * 100}%`, width: `${element.displayWidth / field.width * 100}%`, height: `${element.displayHeight / field.height * 100}%`, background: spec.color, transform: `rotate(${element.rotation}deg)` }} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const point = pointFromEvent(event); setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y }); onSelect(element.id); }} onPointerMove={(event) => { if (!drag || drag.id !== element.id) return; const point = pointFromEvent(event); onMove(element.id, point.x - drag.dx, point.y - drag.dy); }} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
              <span className="element-ui"><span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small></span>
              {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
            </button>;
          })}
          <div className="axis-hint">滚轮平移 · Ctrl/⌘+滚轮缩放 · 空白处拖动</div>
        </div>
      </div>
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </section>;
}
