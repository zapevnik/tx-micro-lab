/** Подсветка участников транзакции (5.6) и пути выбранной трассы (5.11) — с кэшем по ссылкам. */
import { txParticipants } from '@/schema/analysis';
import type { Schema } from '@/schema/types';

export interface Highlight {
  participants: Set<string>;
  coordinator: string | null;
}

let cacheKey: [Schema | null, string | null] = [null, null];
let cacheVal: Highlight | null = null;

export function getHighlight(schema: Schema, endpointId: string | null): Highlight | null {
  if (!endpointId) return null;
  if (cacheKey[0] === schema && cacheKey[1] === endpointId) return cacheVal;
  const ep = schema.endpoints.find((e) => e.id === endpointId);
  cacheVal = ep?.transaction
    ? (() => {
        const { participants, coordinator } = txParticipants(schema, ep);
        return { participants: new Set(participants), coordinator };
      })()
    : ep
      ? { participants: new Set([ep.serviceId, ...ep.steps.map((s) => s.targetId).filter((x): x is string => !!x)]), coordinator: null }
      : null;
  cacheKey = [schema, endpointId];
  return cacheVal;
}
