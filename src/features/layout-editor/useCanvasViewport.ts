import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldSize } from '../../types';
import {
  calculateFitScale,
  clampPan,
  pixelsPerMeter,
  resetView,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
  type ViewTransform,
  type ViewportSize,
} from './viewport';

export interface CanvasViewport {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: ViewportSize;
  view: ViewTransform;
  fitScale: number;
  ppm: number;
  isPanning: boolean;
  zoomPercent: number;
  zoomBy: (factor: number) => void;
  reset: () => void;
  toWorld: (clientPoint: { clientX: number; clientY: number }) => { x: number; y: number };
  toScreen: (worldPoint: { x: number; y: number }) => { x: number; y: number };
  onViewportPointerDown: (event: React.PointerEvent) => void;
}

const DEFAULT_VIEW: ViewTransform = { zoom: 1, panX: 0, panY: 0 };

export function useCanvasViewport(field: FieldSize): CanvasViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const initializedRef = useRef(false);
  const panState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  // 始终使用最新的视图/尺寸处理事件，避免频繁重新绑定监听器
  const latest = useRef({ view, fitScale, viewport });
  latest.current = { view, fitScale, viewport };

  // 测量视口：ResizeObserver 保证容器布局变化后换算基准仍然准确
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 视口或场地尺寸变化：重新计算适配比例。
  // 首次测量时居中；之后保持视口中心指向的世界点不变，并重新约束平移边界。
  useEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;
    const nextFit = calculateFitScale(field, viewport);
    setFitScale(nextFit);
    setView((current) => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        return resetView(field, nextFit, viewport);
      }
      const ppmBefore = pixelsPerMeter(fitScale, current.zoom);
      const center = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, current, ppmBefore);
      const ppmAfter = pixelsPerMeter(nextFit, current.zoom);
      const pan = clampPan(
        { x: center.x - viewport.width / 2 / ppmAfter, y: center.y - viewport.height / 2 / ppmAfter },
        field,
        ppmAfter,
        viewport,
      );
      return { ...current, panX: pan.x, panY: pan.y };
    });
    // fitScale 仅在本 effect 内更新，有意不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, field.width, field.height]);

  const zoomBy = useCallback((factor: number) => {
    const { view: current, fitScale: currentFit, viewport: currentViewport } = latest.current;
    if (currentViewport.width === 0) return;
    setView(zoomAtPoint(current, factor, { x: currentViewport.width / 2, y: currentViewport.height / 2 }, field, currentFit, currentViewport));
  }, [field]);

  const zoomToClientPoint = useCallback((clientX: number, clientY: number, factor: number) => {
    const element = containerRef.current;
    const { view: current, fitScale: currentFit, viewport: currentViewport } = latest.current;
    if (!element || currentViewport.width === 0) return;
    const rect = element.getBoundingClientRect();
    setView(zoomAtPoint(
      current,
      factor,
      { x: clientX - rect.left, y: clientY - rect.top },
      field,
      currentFit,
      currentViewport,
    ));
  }, [field]);

  const reset = useCallback(() => {
    const { fitScale: currentFit, viewport: currentViewport } = latest.current;
    if (currentViewport.width === 0) return;
    setView(resetView(field, currentFit, currentViewport));
  }, [field]);

  // Ctrl/⌘ + 滚轮（含触控板捏合）以指针为锚点缩放；普通滚轮平移
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomToClientPoint(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.012));
        return;
      }
      const ppm = pixelsPerMeter(latest.current.fitScale, latest.current.view.zoom);
      const pan = clampPan(
        { x: latest.current.view.panX - event.deltaX / ppm, y: latest.current.view.panY - event.deltaY / ppm },
        field,
        ppm,
        latest.current.viewport,
      );
      setView((current) => ({ ...current, panX: pan.x, panY: pan.y }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [field, zoomToClientPoint]);

  const onViewportPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const element = containerRef.current;
    if (!element) return;
    element.setPointerCapture(event.pointerId);
    panState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: latest.current.view.panX, originY: latest.current.view.panY, moved: false };
    setIsPanning(true);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onPointerMove = (event: PointerEvent) => {
      const state = panState.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const ppm = pixelsPerMeter(latest.current.fitScale, latest.current.view.zoom);
      state.moved = state.moved || Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 3;
      const pan = clampPan(
        { x: state.originX - (event.clientX - state.startX) / ppm, y: state.originY - (event.clientY - state.startY) / ppm },
        field,
        ppm,
        latest.current.viewport,
      );
      setView((current) => ({ ...current, panX: pan.x, panY: pan.y }));
    };
    const endPan = (event: PointerEvent) => {
      if (panState.current?.pointerId === event.pointerId) {
        panState.current = null;
        setIsPanning(false);
      }
    };
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endPan);
    element.addEventListener('pointercancel', endPan);
    return () => {
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endPan);
      element.removeEventListener('pointercancel', endPan);
    };
  }, [field]);

  const ppm = pixelsPerMeter(fitScale, view.zoom);

  const toWorld = useCallback((clientPoint: { clientX: number; clientY: number }) => {
    const element = containerRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    return screenToWorld({ x: clientPoint.clientX - rect.left, y: clientPoint.clientY - rect.top }, latest.current.view, pixelsPerMeter(latest.current.fitScale, latest.current.view.zoom));
  }, []);

  const toScreen = useCallback((worldPoint: { x: number; y: number }) =>
    worldToScreen(worldPoint, latest.current.view, pixelsPerMeter(latest.current.fitScale, latest.current.view.zoom)), []);

  return {
    containerRef,
    viewport,
    view,
    fitScale,
    ppm,
    isPanning,
    zoomPercent: Math.round(view.zoom * 100),
    zoomBy,
    reset,
    toWorld,
    toScreen,
    onViewportPointerDown,
  };
}
