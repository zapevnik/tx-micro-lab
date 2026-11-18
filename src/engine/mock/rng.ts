/** Детерминированный генератор (mulberry32): одинаковый seed → одинаковые цифры (критерий 9.2). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Случайное отклонение ±spread вокруг 1. */
export function jitter(rng: () => number, spread: number): number {
  return 1 + (rng() * 2 - 1) * spread;
}
