/**
 * Слой Canvas 2D поверх холста (ТЗ 3, 5.9): точки-запросы движутся по связям по выборке `flows`.
 * Рисуется в requestAnimationFrame без участия React — держит сотни точек при ≥ 30 кадр/с.
 */
import { useStoreApi } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { FlowItem } from '@/engine/types';
import { flowBus } from '@/features/sim/flowBus';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { bezier, edgeHandles, pointAt, type Bezier } from './geometry';

interface Dot {
  edgeId: string;
  back: boolean;
  color: string;
  start: number;
  dur: number;
}

const MAX_DOTS = 600;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

export function FlowLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();
  const enabled = useUi((s) => s.animation);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const colors = {
      request: cssVar('--flow-request'),
      response: cssVar('--flow-response'),
      message: cssVar('--flow-message'),
      compensation: cssVar('--flow-compensation'),
      error: cssVar('--flow-error'),
    };
    let dots: Dot[] = [];
    let raf = 0;

    const off = flowBus.subscribe((items: FlowItem[]) => {
      if (!items.length) {
        dots = [];
        return;
      }
      const now = performance.now();
      for (const it of items) {
        dots.push({
          edgeId: it.edgeId,
          back: it.dir === 'back',
          color: it.outcome === 'error' ? colors.error : colors[it.kind],
          start: now + it.delayMs,
          dur: it.durationMs,
        });
      }
      if (dots.length > MAX_DOTS) dots = dots.slice(dots.length - MAX_DOTS);
    });

    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const curves = new Map<string, Bezier | null>();
    const curveOf = (edgeId: string): Bezier | null => {
      if (curves.has(edgeId)) return curves.get(edgeId)!;
      const schema = useProject.getState().schema;
      const edge = schema.edges.find((e) => e.id === edgeId);
      const { nodeLookup } = store.getState();
      let b: Bezier | null = null;
      if (edge) {
        const h = edgeHandles(
          edge,
          schema.nodes.find((n) => n.id === edge.source),
          schema.nodes.find((n) => n.id === edge.target),
        );
        const s = nodeLookup.get(edge.source);
        const tn = nodeLookup.get(edge.target);
        const sh = s?.internals.handleBounds?.source?.find((x) => x.id === h.source);
        const th = tn?.internals.handleBounds?.target?.find((x) => x.id === h.target);
        if (s && tn && sh && th) {
          const sp = s.internals.positionAbsolute;
          const tp = tn.internals.positionAbsolute;
          b = bezier(
            { x: sp.x + sh.x + sh.width / 2, y: sp.y + sh.y + sh.height / 2 },
            h.sourcePos,
            { x: tp.x + th.x + th.width / 2, y: tp.y + th.y + th.height / 2 },
            h.targetPos,
          );
        }
      }
      curves.set(edgeId, b);
      return b;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { transform, width, height } = store.getState();
      const [tx, ty, zoom] = transform;
      ctx.clearRect(0, 0, width, height);
      curves.clear();
      const now = performance.now();
      const alive: Dot[] = [];
      const r = Math.max(2, 3.2 * Math.sqrt(zoom));
      for (const d of dots) {
        const p = (now - d.start) / d.dur;
        if (p > 1) continue;
        alive.push(d);
        if (p < 0) continue;
        const c = curveOf(d.edgeId);
        if (!c) continue;
        const pt = pointAt(c, d.back ? 1 - p : p);
        const x = pt.x * zoom + tx;
        const y = pt.y * zoom + ty;
        if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
        ctx.beginPath();
        ctx.fillStyle = d.color;
        ctx.shadowColor = d.color;
        ctx.shadowBlur = 8;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      dots = alive;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      off();
      ro.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled, store]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[4]" data-testid="flow-layer" />;
}
