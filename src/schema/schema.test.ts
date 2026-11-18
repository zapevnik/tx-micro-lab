import { describe, expect, it } from 'vitest';
import { eshopTemplate } from '@/features/projects/templates';
import { shardDatabase } from '@/features/scaling/scaling';
import { clientPath, txNeedsDistributedPattern, txParticipants } from './analysis';
import { parseProject, serializeProject } from './io';
import {
  addEndpoint,
  addNode,
  addStep,
  connect,
  createNode,
  createStep,
  evenMix,
  extractFragment,
  moveStep,
  pasteFragment,
  removeNodes,
  removeStep,
  setPattern,
} from './ops';
import { checkParam, findParamDef } from './params';
import { connectError } from './rules';
import { emptySchema } from './types';
import { hasErrors, validateSchema } from './validate';

describe('правила связей', () => {
  const cli = createNode('client', 'c', { x: 0, y: 0 });
  const svc = createNode('service', 's', { x: 0, y: 0 });
  const db = createNode('database', 'd', { x: 0, y: 0 });
  const s = addNode(addNode(addNode(emptySchema('t'), cli), svc), db);

  it('разрешает клиент → сервис и сервис → БД', () => {
    expect(connectError(s, cli.id, svc.id)).toBeNull();
    expect(connectError(s, svc.id, db.id)).toBeNull();
  });
  it('запрещает БД → сервис, петли и клиент → БД', () => {
    expect(connectError(s, db.id, svc.id)).toBe('noIncoming');
    expect(connectError(s, svc.id, svc.id)).toBe('selfLoop');
    expect(connectError(s, cli.id, db.id)).toBe('notAllowed');
  });
  it('не создаёт дубликат', () => {
    const r = connect(s, cli.id, svc.id);
    if ('error' in r) throw new Error('unexpected');
    expect(connectError(r.schema, cli.id, svc.id)).toBe('duplicate');
  });
});

describe('операции', () => {
  it('удаление сервиса чистит эндпоинты, связи и ссылки шагов', () => {
    const next = removeNodes(eshopTemplate(), ['payment']);
    expect(next.nodes.find((n) => n.id === 'payment')).toBeUndefined();
    expect(next.endpoints.find((e) => e.id === 'ep-pay')).toBeUndefined();
    expect(next.edges.some((e) => e.source === 'payment' || e.target === 'payment')).toBe(false);
    expect(next.endpoints.find((e) => e.id === 'ep-create-order')!.steps[1].targetId).toBeNull();
  });

  it('копирование и вставка дают новые id и сохраняют ссылки внутри фрагмента', () => {
    const s = eshopTemplate();
    const frag = extractFragment(s, ['payment', 'payments-db']);
    const { schema, ids } = pasteFragment(s, frag, { x: 50, y: 50 }, (n) => n + ' (копия)');
    expect(ids).toHaveLength(2);
    const newEp = schema.endpoints.find((e) => e.serviceId === ids[0])!;
    expect(newEp.steps[0].targetId).toBe(ids[1]);
    expect(schema.edges.some((e) => e.source === ids[0] && e.target === ids[1])).toBe(true);
  });

  it('перестановка и удаление шагов сохраняют диапазон транзакции', () => {
    let s = moveStep(eshopTemplate(), 'ep-pay', 2, 0);
    expect(s.endpoints.find((e) => e.id === 'ep-pay')!.steps[0].id).toBe('s-p-3');
    s = removeStep(s, 'ep-pay', 's-p-1');
    expect(s.endpoints.find((e) => e.id === 'ep-pay')!.transaction!.fromStepId).not.toBe('s-p-1');
  });

  it('смена паттерна на 2PC подставляет координатора', () => {
    const s = setPattern(eshopTemplate(), 'ep-pay', '2pc');
    expect(s.endpoints.find((e) => e.id === 'ep-pay')!.transaction!.coordinatorId).toBe('payment');
  });

  it('evenMix даёт сумму 100', () => {
    expect(evenMix(['a', 'b', 'c']).reduce((a, m) => a + m.pct, 0)).toBe(100);
  });
});

describe('параметры', () => {
  it('проверяет диапазоны и целые', () => {
    const def = findParamDef('service', 'instances')!;
    expect(checkParam(def, 0)).toBe('belowMin');
    expect(checkParam(def, 1.5)).toBe('notInteger');
    expect(checkParam(def, 4)).toBeNull();
  });
});

describe('проверка схемы', () => {
  it('шаблон «Интернет-магазин» без ошибок', () => {
    expect(validateSchema(eshopTemplate()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('сервис без эндпоинтов — ошибка на узле', () => {
    const svc = createNode('service', 's', { x: 0, y: 0 });
    const issues = validateSchema(addNode(eshopTemplate(), svc));
    expect(issues.some((i) => i.code === 'serviceNoEndpoints' && i.nodeId === svc.id)).toBe(true);
  });

  it('шаг на неподключённый узел — ошибка', () => {
    let s = addEndpoint(eshopTemplate(), 'shipping', 'GET /x', { type: 'http', method: 'GET' });
    const ep = s.endpoints[s.endpoints.length - 1];
    s = addStep(s, ep.id, { ...createStep('dbRead'), targetId: 'orders-db', action: 'readOrder' });
    expect(validateSchema(s).some((i) => i.code === 'stepTargetNotConnected')).toBe(true);
  });

  it('сага-хореография без брокера — ошибка', () => {
    const s = setPattern(eshopTemplate(), 'ep-pay', 'sagaChoreography');
    expect(hasErrors(validateSchema(s))).toBe(true);
    expect(validateSchema(s).some((i) => i.code === 'sagaNoBroker')).toBe(true);
  });
});

describe('шардирование (сценарий 2)', () => {
  it('создаёт N шардов, локальная транзакция становится кросс-шардовой', () => {
    const s0 = eshopTemplate();
    expect(txNeedsDistributedPattern(s0, s0.endpoints.find((e) => e.id === 'ep-pay')!)).toBeNull();
    const s = shardDatabase(s0, 'payments-db', { count: 3, key: 'account_id', strategy: 'hash' });
    expect(s.nodes.filter((n) => n.groupId === 'payments-db' && n.role === 'shard')).toHaveLength(3);
    expect(s.edges.filter((e) => e.kind === 'shard')).toHaveLength(3);
    expect(txNeedsDistributedPattern(s, s.endpoints.find((e) => e.id === 'ep-pay')!)).toBe('crossShard');
    expect(validateSchema(s).some((i) => i.code === 'txCrossShard')).toBe(true);
  });
});

describe('анализ', () => {
  it('участники саги включают вызванные сервисы, их БД и координатора', () => {
    const s = eshopTemplate();
    const { participants, coordinator } = txParticipants(s, s.endpoints.find((e) => e.id === 'ep-create-order')!);
    expect(coordinator).toBe('order');
    expect(participants).toEqual(expect.arrayContaining(['payment', 'inventory', 'payments-db', 'orders-db']));
  });
  it('путь клиента до сервиса', () => {
    expect(clientPath(eshopTemplate(), 'client', 'order')).toEqual(['client', 'order']);
    expect(clientPath(eshopTemplate(), 'client', 'payment')).toBeNull();
  });
});

describe('импорт и экспорт (критерий 9.3)', () => {
  it('экспорт → импорт даёт идентичную схему', () => {
    const s = shardDatabase(eshopTemplate(), 'payments-db', { count: 2, key: 'id', strategy: 'hash' });
    const r = parseProject(serializeProject(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.schema).toEqual(s);
  });
  it('отклоняет более новую версию формата и мусор', () => {
    expect(parseProject('{"schemaVersion": 99}')).toMatchObject({ ok: false, reason: 'newerVersion' });
    expect(parseProject('not json')).toMatchObject({ ok: false, reason: 'notJson' });
    expect(parseProject('{"a":1}')).toMatchObject({ ok: false, reason: 'noVersion' });
  });
});
