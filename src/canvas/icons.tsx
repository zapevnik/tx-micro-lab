import { Box, Copy, Database, DoorOpen, Layers, MessagesSquare, Split, Users, Zap, type LucideIcon } from 'lucide-react';
import type { NodeKind, SchemaNode } from '@/schema/types';

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  client: Users,
  gateway: DoorOpen,
  balancer: Split,
  service: Box,
  database: Database,
  cache: Zap,
  broker: MessagesSquare,
};

/** Цвет акцента элемента — чтобы типы различались не только значком. */
export const KIND_COLOR: Record<NodeKind, string> = {
  client: '#38bdf8',
  gateway: '#2dd4bf',
  balancer: '#34d399',
  service: '#818cf8',
  database: '#f59e0b',
  cache: '#facc15',
  broker: '#c084fc',
};

export function nodeIcon(n: SchemaNode): LucideIcon {
  if (n.role === 'replica') return Copy;
  if (n.scaling?.sharding) return Layers;
  return KIND_ICON[n.kind];
}
