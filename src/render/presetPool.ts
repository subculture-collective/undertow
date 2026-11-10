import type { MilkdropProps } from '../types';

/** Plain code-unit order, so a saved list sorts the same in every browser and locale. */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Presets that automatic changes choose from: the layer's saved favourites that
 * exist in the loaded packs, in code-unit order, or every preset when the pool
 * is 'all' or none of the saved favourites can be found.
 */
export function presetPool(p: Pick<MilkdropProps, 'pool' | 'favourites'>, available: readonly string[]): readonly string[] {
  if (p.pool !== 'favourites') return available;
  const have = new Set(available);
  const list = [...new Set(p.favourites)].filter((n) => have.has(n)).sort(byCodeUnit);
  return list.length ? list : available;
}

/** Deterministic pick for cycle segment k, so previews and exports agree. */
export function pickPreset(seed: number, k: number, pool: readonly string[]): string {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return pool[h % pool.length];
}
