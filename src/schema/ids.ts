let counter = 0;

/** Короткий уникальный id с префиксом, например `svc-k3f9a1`. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  const rnd = Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0');
  return `${prefix}-${rnd}${counter.toString(36).padStart(2, '0')}`;
}

export const ID_PREFIX = {
  client: 'cli',
  gateway: 'gw',
  balancer: 'lb',
  service: 'svc',
  database: 'db',
  cache: 'cache',
  broker: 'mq',
  edge: 'e',
  endpoint: 'ep',
  step: 'st',
  fault: 'f',
  invariant: 'inv',
} as const;
