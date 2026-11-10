/**
 * Whole-frame effects applied after all layers (see render/postfx.ts). Sizes are in pixels of a 1080-pixel short
 * side, so an effect looks the same at every export resolution and in the smaller preview.
 */
export interface Effects {
  grain: { on: boolean; amount: number; size: number; animated: boolean };
  /** `offset` is the colour split at the frame's edge; `bass` scales it on bass hits: 1 doubles it at full bass. */
  aberration: { on: boolean; offset: number; bass: number };
  /** `density` is lines across the frame's short side. */
  crt: { on: boolean; density: number; strength: number; curvature: number };
  vignette: { on: boolean; amount: number; softness: number };
}

export type EffectId = keyof Effects;

export const EFFECT_IDS: readonly EffectId[] = ['grain', 'aberration', 'crt', 'vignette'];

export const defaultEffects = (): Effects => ({
  grain: { on: false, amount: 0.12, size: 1.5, animated: true },
  aberration: { on: false, offset: 4, bass: 1 },
  crt: { on: false, density: 240, strength: 0.35, curvature: 0.15 },
  vignette: { on: false, amount: 0.5, softness: 0.6 },
});

/** Slider ranges, also used to clamp values read from files. */
export const EFFECT_RANGES: { [K in EffectId]: { [P in Exclude<keyof Effects[K], 'on' | 'animated'>]: [number, number] } } = {
  grain: { amount: [0, 0.5], size: [1, 6] },
  aberration: { offset: [0, 30], bass: [0, 3] },
  crt: { density: [60, 1080], strength: [0, 1], curvature: [0, 0.5] },
  vignette: { amount: [0, 1], softness: [0.05, 1] },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fills missing or invalid values from the defaults and clamps numbers to their ranges. */
export function normalizeEffects(x: unknown): Effects {
  const out = defaultEffects();
  if (!isObj(x)) return out;
  for (const id of EFFECT_IDS) {
    const src = x[id];
    if (!isObj(src)) continue;
    const dst = out[id] as unknown as Obj;
    const ranges = EFFECT_RANGES[id] as Record<string, [number, number]>;
    for (const k of Object.keys(dst)) {
      const v = src[k];
      if (typeof dst[k] === 'boolean') { if (typeof v === 'boolean') dst[k] = v; continue; }
      if (typeof v === 'number' && Number.isFinite(v)) dst[k] = Math.min(ranges[k][1], Math.max(ranges[k][0], v));
    }
  }
  return out;
}

/** True when at least one effect would change the frame; when false the compositor skips the pass entirely. */
export function anyEffectOn(e: Effects | undefined): boolean {
  if (!e) return false;
  return (e.grain.on && e.grain.amount > 0)
    || (e.aberration.on && e.aberration.offset > 0)
    || (e.crt.on && (e.crt.strength > 0 || e.crt.curvature > 0))
    || (e.vignette.on && e.vignette.amount > 0);
}
