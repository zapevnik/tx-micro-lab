import { describe, expect, it } from 'vitest';
import { eshopTemplate, travelTemplate } from '@/features/projects/templates';
import { shardDatabase } from '@/features/scaling/scaling';
import { setPattern, updateWorkload } from '@/schema/ops';
import type { Schema } from '@/schema/types';
import { aggregate, prepareRunSchema, runOnce } from './experiments';
import { SimModel } from './model';

function run(model: SimModel, seconds: number, dt = 0.25) {
  let out = model.step(dt);
  for (let t = dt; t < seconds; t += dt) out = model.step(dt);
  return out;
}

function withOptions(s: Schema, epId: string, opts: { idempotentConsumers: boolean; outbox: boolean }): Schema {
  return {
    ...s,
    endpoints: s.endpoints.map((e) =>
      e.id === epId && e.transaction
        ? { ...e, transaction: { ...e.transaction, options: { ...e.transaction.options, ...opts } } }
        : e,
    ),
  };
}

describe('mock-модель', () => {
  it('детерминирована по seed (критерий 9.2)', () => {
    expect(runOnce(eshopTemplate(), 1, 20)).toEqual(runOnce(eshopTemplate(), 1, 20));
  });

  it('при малой нагрузке БД не перегружена, при большой — перегружена (сценарий 1)', () => {
    const calm = run(new SimModel(eshopTemplate(), 1), 10);
    expect(calm.tick.nodes['payments-db'].load).toBeLessThan(0.7);
    const out = run(new SimModel(updateWorkload(eshopTemplate(), 'client', { rps: 700 }), 1), 15);
    expect(out.tick.nodes['payments-db'].load).toBeGreaterThan(0.9);
    expect(out.tick.nodes['payments-db'].queue).toBeGreaterThan(10);
  });

  it('шардирование снимает перегрузку', () => {
    const hot = updateWorkload(eshopTemplate(), 'client', { rps: 700 });
    const sharded = shardDatabase(hot, 'payments-db', { count: 4, key: 'id', strategy: 'hash' });
    const out = run(new SimModel(sharded, 1), 15);
    for (const s of sharded.nodes.filter((n) => n.role === 'shard')) expect(out.tick.nodes[s.id].load).toBeLessThan(0.7);
  });

  it('падение координатора 2PC оставляет зависшие блокировки (сценарий 3)', () => {
    const m = new SimModel(setPattern(eshopTemplate(), 'ep-pay', '2pc'), 1);
    run(m, 5);
    m.injectFault('f1', { type: 'coordinatorCrash', endpointId: 'ep-pay', after: 'prepare' });
    const out = run(m, 5);
    expect(out.tick.nodes['payments-db'].locks).toBeGreaterThan(30);
    expect(out.tick.global.stuck).toBeGreaterThan(0);
  });

  it('при долгом падении координатора метрики остаются конечными и правдоподобными', () => {
    let s = setPattern(updateWorkload(eshopTemplate(), 'client', { rps: 750 }), 'ep-pay', '2pc');
    s = shardDatabase(s, 'payments-db', { count: 4, key: 'id', strategy: 'hash' });
    const m = new SimModel(s, 1);
    run(m, 5);
    m.injectFault('f1', { type: 'coordinatorCrash', endpointId: 'ep-pay', after: 'prepare' });
    const out = run(m, 60);
    for (const nm of Object.values(out.tick.nodes)) {
      expect(nm.p99).toBeLessThan(200_000);
      expect(nm.locks ?? 0).toBeLessThan(50_000);
    }
    expect(out.tick.global.p99).toBeLessThan(200_000);
  });

  it('дубли без идемпотентности дают нарушения, с идемпотентностью — нет (сценарий 4)', () => {
    const base = travelTemplate();
    expect(run(new SimModel(base, 3), 30).tick.global.violationsTotal).toBeGreaterThan(0);
    const good = withOptions(base, 'ep-book', { idempotentConsumers: true, outbox: true });
    expect(run(new SimModel(good, 3), 30).tick.global.violationsTotal).toBe(0);
  });

  it('паттерны дают разные цифры в сравнении', () => {
    const s = eshopTemplate();
    const r2pc = aggregate('2pc', 300, [runOnce(prepareRunSchema(s, 'ep-create-order', '2pc', 300), 1, 30)]);
    const rSaga = aggregate('sagaOrchestration', 300, [
      runOnce(prepareRunSchema(s, 'ep-create-order', 'sagaOrchestration', 300), 1, 30),
    ]);
    expect(Math.abs(r2pc.p99.mean - rSaga.p99.mean)).toBeGreaterThan(1);
    expect(r2pc.messagesPerTx.mean).toBeGreaterThan(rSaga.messagesPerTx.mean);
  });

  it('генерирует трассу для транзакции из recentTx', () => {
    const m = new SimModel(eshopTemplate(), 5);
    let tx;
    for (let i = 0; i < 40 && !tx; i++) tx = m.step(0.25).tick.recentTx?.[0];
    expect(tx).toBeDefined();
    expect(m.getTrace(tx!.txId)?.spans.length).toBeGreaterThan(1);
  });
});
