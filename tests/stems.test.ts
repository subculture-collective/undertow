import { describe, expect, it } from 'vitest';
import { createLayer } from '../src/defaults';
import { toProject } from '../src/projectShape';
import { layerSource, pickTrack, STEM_MODEL, stemBlob, stemChannels, stemsKey, storedStemsUsable, type StoredStems } from '../src/audio/stems';
import { BINS, SOURCES, unmix, type UnmixModel } from '../src/audio/unmix';

function noise(n: number, seed: number) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out[i] = (seed / 2 ** 32 - 0.5) * 0.8;
  }
  return out;
}

/** A stand-in model that gives every source a fixed share of the mix's magnitude. */
const shares = (w: number[]): UnmixModel => async (mag, frames) => {
  const est = new Float32Array(SOURCES * 2 * BINS * frames);
  for (let s = 0; s < SOURCES; s++) for (let i = 0; i < mag.length; i++) est[s * mag.length + i] = mag[i] * w[s];
  return est;
};

const maxErr = (a: Int16Array, b: Float32Array, k = 1) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] / 32767 - b[i] * k));
  return m;
};

describe('unmix', () => {
  const L = noise(22050 + 123, 1), R = noise(22050 + 123, 2);

  it('rebuilds the mix exactly when the model hears one source, across chunk seams', async () => {
    let calls = 0;
    const model: UnmixModel = (mag, frames) => { calls++; return shares([0, 0, 1, 0])(mag, frames); };
    const stems = await unmix(L, R, model, { chunk: 5, context: 2 });
    expect(calls).toBeGreaterThan(3);
    expect(stems).toHaveLength(SOURCES);
    expect(maxErr(stems[2][0], L)).toBeLessThan(2e-4);
    expect(maxErr(stems[2][1], R)).toBeLessThan(2e-4);
    for (const s of [0, 1, 3]) expect(maxErr(stems[s][0], L, 0)).toBeLessThan(2e-4);
  });

  it('splits by the ratio of the estimates, so the stems add up to the mix', async () => {
    const stems = await unmix(L, R, shares([3, 1, 0, 0]), { chunk: 8, context: 3 });
    expect(maxErr(stems[0][0], L, 0.75)).toBeLessThan(2e-4);
    expect(maxErr(stems[1][1], R, 0.25)).toBeLessThan(2e-4);
  });

  it('reports progress up to the total frame count', async () => {
    const seen: [number, number][] = [];
    await unmix(L, R, shares([1, 1, 1, 1]), { chunk: 6, onProgress: (d, t) => seen.push([d, t]) });
    const total = 1 + Math.floor(L.length / 1024);
    expect(seen.map(([, t]) => t).every((t) => t === total)).toBe(true);
    expect(seen.map(([d]) => d)).toEqual([...seen.map(([d]) => d)].sort((a, b) => a - b));
    expect(seen.at(-1)![0]).toBe(total);
  });
});

describe('layer source', () => {
  it('defaults to the whole song for layers saved without a source', () => {
    const p = toProject({ layers: [{ type: 'spectrum', props: { bars: 32 } }, { type: 'vu' }] })!;
    expect(p.layers.every((l) => !('source' in l.props))).toBe(true);
    expect(p.layers.map(layerSource)).toEqual(['mix', 'mix']);
  });

  it('keeps a saved stem and ignores unknown values and non-reactive layers', () => {
    const p = toProject({ layers: [
      { type: 'vu', props: { source: 'drums' } },
      { type: 'particles', props: { source: 'kazoo' } },
      { type: 'text', props: { source: 'vocals' } },
    ] })!;
    expect(p.layers.map(layerSource)).toEqual(['drums', 'mix', 'mix']);
  });

  it('every new layer starts on the whole song', () => {
    for (const t of ['video', 'particles', 'milkdrop', 'image', 'waveform', 'spectrum', 'vu'] as const) expect(layerSource(createLayer(t))).toBe('mix');
  });

  it('falls back to the mix when the stem is missing', () => {
    const stems = { drums: 'D', bass: 'B', other: 'O', vocals: 'V' };
    expect(pickTrack('mix', 'M', stems)).toEqual({ track: 'M', stem: null, fallback: false });
    expect(pickTrack('bass', 'M', stems)).toEqual({ track: 'B', stem: 'bass', fallback: false });
    expect(pickTrack('bass', 'M', undefined)).toEqual({ track: 'M', stem: null, fallback: true });
  });
});

describe('stored stems', () => {
  const song = { sampleRate: 44100, length: 10 };
  const blob = () => stemBlob(new Int16Array(10), new Int16Array(10));
  const row = (over: Partial<StoredStems> = {}): StoredStems => ({
    model: STEM_MODEL.id, sampleRate: 44100, length: 10,
    stems: { drums: blob(), bass: blob(), other: blob(), vocals: blob() },
    ...over,
  });

  it('are keyed by the song asset', () => expect(stemsKey('a1')).toBe('a1'));
  it('are reused for the same model and song', () => expect(storedStemsUsable(row(), song)).toBe(true));
  it('are ignored after a model change, for another song length, or when incomplete', () => {
    expect(storedStemsUsable(row({ model: 'older' }), song)).toBe(false);
    expect(storedStemsUsable(row(), { ...song, length: 11 })).toBe(false);
    expect(storedStemsUsable(row(), { ...song, sampleRate: 48000 })).toBe(false);
    const partial = row();
    delete (partial.stems as Partial<StoredStems['stems']>).vocals;
    expect(storedStemsUsable(partial, song)).toBe(false);
    expect(storedStemsUsable(row({ stems: { ...row().stems, bass: new Blob([new Int16Array(10)]) } }), song)).toBe(false);
    expect(storedStemsUsable(undefined, song)).toBe(false);
  });
  it('round-trip both channels through one Blob per stem', async () => {
    const L = Int16Array.from({ length: 10 }, (_, i) => i * 100 - 300), R = Int16Array.from({ length: 10 }, (_, i) => -i);
    const [l, r] = await stemChannels(stemBlob(L, R), 10);
    expect([...l]).toEqual([...L]);
    expect([...r]).toEqual([...R]);
  });
});
