import { describe, expect, it } from 'vitest';
import { detectTempo } from '../src/audio/tempo';
import { activeTempo, cycleSegment } from '../src/render/presetPool';
import { toProject } from '../src/projectShape';

const RATE = 22050;

/** A drum-machine loop: kick on every beat, hi-hat between, a sustained pad, starting `offset` seconds in. */
function loop(bpm: number, seconds: number, offset: number, swing = 0) {
  const n = Math.round(seconds * RATE), out = new Float32Array(n);
  const beat = 60 / bpm;
  let seed = 7;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] = 0.08 * Math.sin(2 * Math.PI * 220 * t) + 0.05 * Math.sin(2 * Math.PI * 330 * t);
    if (t < offset) continue;
    const tb = (t - offset) % beat, th = (t - offset + beat / 2 + swing) % beat;
    out[i] += Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 10) * 0.9;
    out[i] += noise() * Math.exp(-th * 70) * 0.15;
  }
  return out;
}

it.each([
  [120, 0], [128, 0.21], [90, 0.4], [100, 0.33], [140, 0.12],
])('finds %d BPM and the first beat at %ss', (bpm, offset) => {
  const est = detectTempo([loop(bpm, 30, offset)], RATE)!;
  expect(est.bpm).toBeCloseTo(bpm, 0);
  // Within 15 ms of the first kick, modulo one beat.
  const beat = 60 / bpm, err = Math.abs(((est.offset - offset) % beat + beat * 1.5) % beat - beat / 2);
  expect(err).toBeLessThan(0.015);
  expect(est.confidence).toBeGreaterThan(0.2);
});

it('lands on 174 BPM or its half for a fast drum-and-bass loop', () => {
  const est = detectTempo([loop(174, 30, 0.05)], RATE)!;
  const bpm = est.bpm < 120 ? est.bpm * 2 : est.bpm;
  expect(bpm).toBeCloseTo(174, 0);
});

it('works at 44.1 kHz too', () => {
  const rate = 44100, n = rate * 20, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const tb = ((i / rate) - 0.3 + 10) % 0.5; out[i] = i / rate < 0.3 ? 0 : Math.sin(2 * Math.PI * 60 * tb) * Math.exp(-tb * 12); }
  const est = detectTempo([out], rate)!;
  expect(est.bpm).toBeCloseTo(120, 0);
  expect(Math.abs(est.offset - 0.3)).toBeLessThan(0.015);
});

it('returns nothing for silence or very short audio', () => {
  expect(detectTempo([new Float32Array(RATE * 10)], RATE)).toBeNull();
  expect(detectTempo([loop(120, 1, 0)], RATE)).toBeNull();
});

describe('preset segments on the beat grid', () => {
  const bars = { cycle: 20, cycleUnit: 'bars' as const, cycleBars: 4 };
  const tempo = { bpm: 120, offset: 0.3 };

  it('changes every N bars of four beats from the first beat', () => {
    // 4 bars at 120 BPM = 8 s; boundaries at 0.3, 8.3, 16.3 …
    expect(cycleSegment(bars, 0, tempo)).toBe(0);
    expect(cycleSegment(bars, 8.29, tempo)).toBe(0);
    expect(cycleSegment(bars, 8.3, tempo)).toBe(1);
    expect(cycleSegment(bars, 16.3, tempo)).toBe(2);
  });

  it('switches on the first export frame at or after each bar line, at any frame rate', () => {
    for (const fps of [24, 30, 60]) {
      for (let k = 1; k <= 20; k++) {
        const line = tempo.offset + k * 8;
        const first = Math.ceil((line - 1e-9) * fps);
        expect(cycleSegment(bars, (first - 1) / fps, tempo)).toBe(k - 1);
        expect(cycleSegment(bars, first / fps, tempo)).toBe(k);
        expect(first / fps - line).toBeLessThan(1 / fps);
      }
    }
  });

  it('uses the seconds setting without a tempo, and for projects saved before bars existed', () => {
    expect(cycleSegment(bars, 41, null)).toBe(2);
    expect(cycleSegment({ cycle: 10, cycleUnit: 'seconds', cycleBars: 4 }, 41, tempo)).toBe(4);
    expect(cycleSegment({ cycle: 0, cycleUnit: 'bars', cycleBars: 4 }, 41, tempo)).toBe(0);
  });

  it('only uses a tempo found for the current song', () => {
    const t = { bpm: 128, offset: 0, audioAssetId: 'a', manual: false };
    expect(activeTempo({ audioAssetId: 'a', tempo: t })).toBe(t);
    expect(activeTempo({ audioAssetId: 'b', tempo: t })).toBeNull();
  });

  it('keeps a saved tempo when loading and drops a broken one', () => {
    const ok = toProject({ layers: [], audioAssetId: 'a', tempo: { bpm: 98.5, offset: 0.2, audioAssetId: 'a', manual: true } })!;
    expect(ok.tempo).toEqual({ bpm: 98.5, offset: 0.2, audioAssetId: 'a', manual: true });
    expect(toProject({ layers: [], tempo: { bpm: 'fast', offset: 0, audioAssetId: 'a' } })!.tempo).toBeUndefined();
    expect(toProject({ layers: [{ type: 'milkdrop', props: { cycle: 12 } }] })!.layers[0].props).toMatchObject({ cycle: 12, cycleUnit: 'seconds' });
  });
});
