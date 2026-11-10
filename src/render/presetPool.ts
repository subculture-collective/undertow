import type { MilkdropProps, Project, Tempo } from '../types';

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

export const BEATS_PER_BAR = 4;

/** The project's tempo, if it belongs to the project's current song. */
export const activeTempo = (p: Pick<Project, 'tempo' | 'audioAssetId'>): Tempo | null =>
  p.tempo && p.tempo.audioAssetId === p.audioAssetId && p.tempo.bpm > 0 ? p.tempo : null;

/**
 * Which preset segment time t falls in. In seconds mode that is floor(t / cycle).
 * In bars mode segments start on the beat grid, every cycleBars bars of four
 * beats from the first beat; time before the first beat stays in segment 0.
 * Without a tempo, bars mode falls back to the seconds setting.
 */
export function cycleSegment(
  p: Pick<MilkdropProps, 'cycle' | 'cycleUnit' | 'cycleBars'>, t: number, tempo: Pick<Tempo, 'bpm' | 'offset'> | null,
): number {
  if (!(p.cycle > 0)) return 0;
  if (p.cycleUnit === 'bars' && tempo && tempo.bpm > 0) {
    const len = (Math.max(1, Math.round(p.cycleBars)) * BEATS_PER_BAR * 60) / tempo.bpm;
    // A microsecond of slack keeps a frame that lands exactly on a bar line from rounding into the previous segment.
    return Math.max(0, Math.floor((t - tempo.offset + 1e-6) / len));
  }
  return Math.floor(t / p.cycle);
}
