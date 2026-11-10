import { expect, it } from 'vitest';
import { PEAK_FALL, PEAK_HOLD, spectrumBands, stepPeaks } from '../src/render/layers';

const centres = (bands: [number, number][]) => bands.map(([lo, hi]) => Math.sqrt(lo * hi));

it('gives the 31 ISO third-octave bands between 20 Hz and 20 kHz', () => {
  const bands = spectrumBands({ spacing: 'octave-1/3', bars: 64, minHz: 20, maxHz: 20000 });
  expect(bands).toHaveLength(31);
  const c = centres(bands);
  expect(c[0]).toBeCloseTo(19.95, 1);
  expect(c[17]).toBeCloseTo(1000, 6);
  expect(c[30]).toBeCloseTo(19953, 0);
  // Each band starts where the previous one ends.
  for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBeCloseTo(bands[i - 1][1], 6);
});

it('keeps only bands that overlap the low and high cut', () => {
  const c = centres(spectrumBands({ spacing: 'octave-1/3', bars: 64, minHz: 30, maxHz: 16000 }));
  expect(c[0]).toBeCloseTo(31.6, 1);
  expect(c.at(-1)).toBeCloseTo(15849, 0);
  expect(spectrumBands({ spacing: 'octave-1/6', bars: 64, minHz: 20, maxHz: 20000 })).toHaveLength(61);
});

it('splits the range evenly on a log scale in bar-count mode, as before', () => {
  const bands = spectrumBands({ spacing: 'count', bars: 8, minHz: 30, maxHz: 16000 });
  expect(bands).toHaveLength(8);
  expect(bands[0][0]).toBeCloseTo(30, 9);
  expect(bands[7][1]).toBeCloseTo(16000, 6);
  const ratio = bands[0][1] / bands[0][0];
  for (const [lo, hi] of bands) expect(hi / lo).toBeCloseTo(ratio, 9);
});

it('drops peak caps at the same speed at 24, 30 and 60 fps', () => {
  const after = (fps: number, seconds: number) => {
    const peaks = new Float32Array(1), held = new Float32Array(1);
    stepPeaks(Float32Array.of(1), peaks, held, 1 / fps);
    for (let i = 0; i < Math.round(seconds * fps); i++) stepPeaks(Float32Array.of(0), peaks, held, 1 / fps);
    return peaks[0];
  };
  for (const fps of [24, 30, 60]) {
    expect(after(fps, PEAK_HOLD / 2)).toBe(1);
    expect(after(fps, 1)).toBeCloseTo(1 - PEAK_FALL * (1 - PEAK_HOLD), 1);
  }
  expect(Math.abs(after(24, 1) - after(60, 1))).toBeLessThan(PEAK_FALL / 24 + 1e-6);
});

it('lets a peak cap rest on its bar instead of falling through it', () => {
  const peaks = Float32Array.of(0.9), held = Float32Array.of(0);
  for (let i = 0; i < 120; i++) stepPeaks(Float32Array.of(0.5), peaks, held, 1 / 60);
  expect(peaks[0]).toBeCloseTo(0.5, 6);
});
