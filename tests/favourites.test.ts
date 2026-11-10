import { expect, it } from 'vitest';
import { pickPreset, presetPool } from '../src/render/presetPool';
import { toProject } from '../src/projectShape';

const ALL = ['Alpha', 'beta', 'Gamma', 'delta', 'Epsilon', 'zeta'];

it('keeps every preset in the pool unless favourites are chosen', () => {
  expect(presetPool({ pool: 'all', favourites: ['Gamma'] }, ALL)).toBe(ALL);
});

it('limits the pool to saved favourites that exist, in code-unit order', () => {
  expect(presetPool({ pool: 'favourites', favourites: ['zeta', 'Gone', 'Alpha', 'zeta'] }, ALL)).toEqual(['Alpha', 'zeta']);
});

it('falls back to every preset when no saved favourite exists', () => {
  expect(presetPool({ pool: 'favourites', favourites: ['Gone'] }, ALL)).toBe(ALL);
  expect(presetPool({ pool: 'favourites', favourites: [] }, ALL)).toBe(ALL);
});

it('only ever picks favourites, the same way every time', () => {
  const pool = presetPool({ pool: 'favourites', favourites: ['delta', 'beta', 'Epsilon'] }, ALL);
  const seq = Array.from({ length: 50 }, (_, k) => pickPreset(7, k, pool));
  expect(new Set(seq).size).toBeGreaterThan(1);
  for (const n of seq) expect(pool).toContain(n);
  // The saved order doesn't matter: the pool is sorted before hashing.
  const again = presetPool({ pool: 'favourites', favourites: ['Epsilon', 'delta', 'beta'] }, ALL);
  expect(Array.from({ length: 50 }, (_, k) => pickPreset(7, k, again))).toEqual(seq);
});

it('loads projects saved before favourites with the whole preset pool', () => {
  const p = toProject({ layers: [{ type: 'milkdrop', props: { preset: 'x', cycle: 10, blendTime: 2, seed: 3, gain: 1 } }] })!;
  expect(p.layers[0].props).toMatchObject({ pool: 'all', favourites: [], cycle: 10, seed: 3 });
});
