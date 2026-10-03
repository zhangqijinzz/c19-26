import { useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import type { LayoutMode, PathPreview, RenderElement } from '../../types';
import { gridStep, rulerStep, tickValues } from './viewport';
import type { CanvasViewport } from './useCanvasViewport';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedId: string | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  viewport: CanvasViewport;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  fieldSize: number;
  start: number;
  span: number;
  ppm: number;
}

const MINOR_DIVISIONS = 2;

function Ruler({ orientation, fieldSize, start, span, ppm }: RulerProps) {
  const major = rulerStep(ppm);
  const minor = major / MINOR_DIVISIONS;
  const allTicks = tickValues(start, start + span, minor);
  const majorTicks = new Set(tickValues(start, start + span, major));
  const position = (value: number) => (value - start) * ppm;
  const labelFor = (value: number) => (value >= -minor / 10 && value <= fieldSize + minor / 10 ? value : null);
  return <div className={`canvas-ruler ruler-${orientation}`} aria-hidden="true">
    {allTicks.map((value) => {
      const isMajor = majorTicks.has(value);
      const label = isMajor ? labelFor(value) : null;
      return <span key={value} className={isMajor ? 'ruler-tick is-major' : 'ruler-tick'} style={orientation === 'horizontal' ? { left: position(value) } : { top: position(value) }}>
        <i />{label !== null ? <em>{label}</em> : null}
      </span>;
    })}
  </div>;
}

export function FieldCanvas({ field, elements, selectedId, mode, overlaps, bounds, channels, path, viewport, onSelect, onMove }: FieldCanvasProps) {
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const movedRef = useRef(false);
  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const { ppm, view, viewport: viewportSize } = viewport;
  const ready = viewportSize.width > 0 && viewportSize.height > 0;
  const step = gridStep(ppm);
  const origin = viewport.toScreen({ x: 0, y: 0 });

  const pointFromEvent = (event: React.PointerEvent) => viewport.toWorld(event);

  const screenPoints = path ? path.points.map((point) => viewport.toScreen(point)) : [];

  return <div className="canvas-wrap">
    <div
      className={`canvas-viewport mode-${mode}${viewport.isPanning ? ' is-panning' : ''}`}
      ref={viewport.containerRef}
      onPointerDown={viewport.onViewportPointerDown}
    >
      {ready ? <>
        <div className="world-layer" style={{ left: origin.x, top: origin.y }}>
          <div className="field-canvas" style={{ width: field.width * ppm, height: field.height * ppm }}>
            <div className="grid-overlay" style={{ backgroundSize: `${step * ppm}px ${step * ppm}px` }} />
            <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
            {elements.map((element) => {
              const spec = ELEMENT_SPECS[element.kind];
              const screenW = element.displayWidth * ppm;
              const screenH = element.displayHeight * ppm;
              const densityClass = screenW < 18 || screenH < 14 ? 'is-tiny' : screenW < 52 || screenH < 34 ? 'is-micro' : screenW < 86 || screenH < 52 ? 'is-dense' : '';
              const classes = ['canvas-element', densityClass, selectedId === element.id ? 'is-selected' : '', issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '', channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '', boundsIds.has(element.id) ? 'is-out' : ''].filter(Boolean).join(' ');
              return <button
                key={element.id}
                type="button"
                className={classes}
                style={{ left: element.x * ppm, top: element.y * ppm, width: screenW, height: screenH, background: spec.color, transform: `rotate(${element.rotation}deg)` }}
                onPointerDown={(event) => {
                  // 阻止事件冒泡到视口，否则空白平移会抢走元素拖拽
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const point = pointFromEvent(event);
                  movedRef.current = false;
                  setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y });
                  onSelect(element.id);
                }}
                onPointerMove={(event) => {
                  if (!drag || drag.id !== element.id) return;
                  movedRef.current = true;
                  const point = pointFromEvent(event);
                  onMove(element.id, point.x - drag.dx, point.y - drag.dy);
                }}
                onPointerUp={() => setDrag(null)}
                onPointerCancel={() => setDrag(null)}
                onClickCapture={(event) => { if (!movedRef.current) return; event.stopPropagation(); event.preventDefault(); }}
              >
                <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small>
                {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
              </button>;
            })}
            <div className="axis-hint">拖动元素 · 点击选中</div>
          </div>
        </div>
        {path && mode === 'path' ? <svg className="path-layer" width={viewportSize.width} height={viewportSize.height}>
          <polyline points={screenPoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="1.5" strokeDasharray="5 4" />
          <circle cx={screenPoints[0].x} cy={screenPoints[0].y} r="4.5" fill="#ef795f" />
          <circle cx={screenPoints[screenPoints.length - 1].x} cy={screenPoints[screenPoints.length - 1].y} r="4.5" fill="#ef795f" />
        </svg> : null}
        <Ruler orientation="horizontal" fieldSize={field.width} start={view.panX} span={viewportSize.width / ppm} ppm={ppm} />
        <Ruler orientation="vertical" fieldSize={field.height} start={view.panY} span={viewportSize.height / ppm} ppm={ppm} />
        <div className="ruler-corner">m</div>
      </> : null}
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </div>;
}
