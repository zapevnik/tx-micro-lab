/**
 * Геометрия связей: те же кривые Безье, что рисует React Flow (getBezierPath), чтобы точки-запросы
 * в Canvas-слое двигались ровно по линиям связей.
 */
import { Position } from '@xyflow/react';
import type { SchemaEdge, SchemaNode } from '@/schema/types';

export interface Pt {
  x: number;
  y: number;
}

export interface EdgeHandles {
  source: string;
  target: string;
  sourcePos: Position;
  targetPos: Position;
}

const CALL: EdgeHandles = { source: 'out', target: 'in', sourcePos: Position.Right, targetPos: Position.Left };

/**
 * Маркеры связи. Вызовы всегда идут справа налево; служебные связи шардов и реплик выходят
 * с той стороны БД, где стоят производные узлы (они могут оказаться снизу, сверху или сбоку).
 */
export function edgeHandles(edge: Pick<SchemaEdge, 'kind'>, source?: SchemaNode, target?: SchemaNode): EdgeHandles {
  if (edge.kind === 'call' || !source || !target) return CALL;
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  if (Math.abs(dy) > Math.abs(dx) * 0.6) {
    return dy > 0
      ? { source: 'down', target: 'up', sourcePos: Position.Bottom, targetPos: Position.Top }
      : { source: 'upout', target: 'downin', sourcePos: Position.Top, targetPos: Position.Bottom };
  }
  return dx > 0
    ? { source: 'side', target: 'in', sourcePos: Position.Right, targetPos: Position.Left }
    : { source: 'leftout', target: 'rightin', sourcePos: Position.Left, targetPos: Position.Right };
}

function controlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

function control(pos: Position, a: Pt, b: Pt, c: number): Pt {
  switch (pos) {
    case Position.Left:
      return { x: a.x - controlOffset(a.x - b.x, c), y: a.y };
    case Position.Right:
      return { x: a.x + controlOffset(b.x - a.x, c), y: a.y };
    case Position.Top:
      return { x: a.x, y: a.y - controlOffset(a.y - b.y, c) };
    case Position.Bottom:
      return { x: a.x, y: a.y + controlOffset(b.y - a.y, c) };
  }
}

export interface Bezier {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
}

export function bezier(s: Pt, sPos: Position, tgt: Pt, tPos: Position, curvature = 0.25): Bezier {
  return { p0: s, p1: control(sPos, s, tgt, curvature), p2: control(tPos, tgt, s, curvature), p3: tgt };
}

export function pointAt(b: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const c1 = 3 * u * u * t;
  const c2 = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * b.p0.x + c1 * b.p1.x + c2 * b.p2.x + d * b.p3.x,
    y: a * b.p0.y + c1 * b.p1.y + c2 * b.p2.y + d * b.p3.y,
  };
}

/** Толщина связи пропорциональна трафику (5.9), в логарифмической шкале. */
export function edgeWidth(rps: number): number {
  return 1.5 + Math.min(7, Math.log10(1 + Math.max(0, rps)) * 1.8);
}
