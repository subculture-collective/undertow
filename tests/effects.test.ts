import { describe, expect, it } from 'vitest';
import { starterProject } from '../src/defaults';
import { anyEffectOn, defaultEffects, normalizeEffects } from '../src/effects';
import { toProject } from '../src/projectShape';
import { grainSeed } from '../src/render/postfx';

describe('effects', () => {
  it('are all off by default and in projects saved before effects existed', () => {
    expect(anyEffectOn(defaultEffects())).toBe(false);
    expect(anyEffectOn(undefined)).toBe(false);
    const p = toProject(JSON.parse(JSON.stringify(starterProject())))!;
    expect(p.effects).toBeUndefined();
    expect(anyEffectOn(p.effects)).toBe(false);
  });

  it('count as on only when switched on with a visible setting', () => {
    const e = defaultEffects();
    e.grain.on = true;
    expect(anyEffectOn(e)).toBe(true);
    e.grain.amount = 0;
    expect(anyEffectOn(e)).toBe(false);
    e.aberration = { on: true, offset: 0, bass: 2 };
    expect(anyEffectOn(e)).toBe(false);
    e.vignette.on = true;
    expect(anyEffectOn(e)).toBe(true);
  });

  it('fill missing values, clamp numbers and ignore wrong types when loaded', () => {
    const e = normalizeEffects({
      grain: { on: true, amount: 9, size: 'big' },
      crt: { on: 'yes', density: 10, curvature: Number.NaN },
      vignette: null,
      hologram: { on: true },
    });
    const d = defaultEffects();
    expect(e.grain).toEqual({ ...d.grain, on: true, amount: 0.5 });
    expect(e.crt).toEqual({ ...d.crt, density: 60 });
    expect(e.vignette).toEqual(d.vignette);
    expect(e).not.toHaveProperty('hologram');
    expect(normalizeEffects('nope')).toEqual(d);
  });

  it('survive a save and load', () => {
    const p = starterProject();
    p.effects = defaultEffects();
    p.effects.crt.on = true;
    expect(toProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('seed grain from time alone, so re-exports match', () => {
    expect(grainSeed(1.5)).toBe(grainSeed(45 / 30));
    expect(grainSeed(1 / 30)).not.toBe(grainSeed(2 / 30));
  });
});
