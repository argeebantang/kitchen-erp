/**
 * A seeded random generator (mulberry32), so the same --seed always produces
 * the same history: a figure the AI quotes can be traced back on a re-run.
 * Math.random cannot be seeded.
 */
export type Random = {
  /** In [0, 1). */
  next(): number
  /** True with probability p. */
  chance(p: number): boolean
  /** An integer in [min, max]. */
  int(min: number, max: number): number
  /** A number in [min, max). */
  between(min: number, max: number): number
  pick<T>(items: readonly T[]): T
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    chance:  p => next() < p,
    int:     (min, max) => min + Math.floor(next() * (max - min + 1)),
    between: (min, max) => min + next() * (max - min),
    pick:    items => items[Math.floor(next() * items.length)],
  }
}
