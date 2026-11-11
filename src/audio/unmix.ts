import { FFT } from './analysis';

/**
 * Splits a stereo song into four stems with a spectrogram-masking model such
 * as Open-Unmix. The model sees magnitude STFT frames; its estimates become
 * ratio masks on the mix's complex STFT, so the stems add up to the mix.
 * Pure DSP: the model is passed in, so tests can use a stand-in.
 */

export const N_FFT = 4096;
export const HOP = 1024;
export const BINS = N_FFT / 2 + 1;
export const SOURCES = 4;

/** Magnitudes in, shape (1, 2, BINS, frames); per-source magnitude estimates out, shape (SOURCES, 2, BINS, frames). */
export type UnmixModel = (mag: Float32Array, frames: number) => Promise<Float32Array>;

export interface UnmixOptions {
  /** STFT frames kept per model call. */
  chunk?: number;
  /** Extra frames the model sees on each side of a chunk, so the recurrent layers have context at the seams. */
  context?: number;
  onProgress?: (done: number, total: number) => void;
}

const PAD = N_FFT / 2;
const WIN = Float32Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));

/** Number of STFT frames for a signal, centred as in torch.stft(center=True). */
export const frameCount = (length: number) => 1 + Math.floor(length / HOP);

/**
 * Returns 16-bit PCM per stem and channel, `[source][channel]`, the same
 * length as the input. Sources are in the model's output order.
 */
export async function unmix(left: Float32Array, right: Float32Array, model: UnmixModel, o: UnmixOptions = {}): Promise<Int16Array[][]> {
  const len = left.length;
  const T = frameCount(len);
  const C = o.chunk ?? 512, M = o.context ?? 64;
  const fft = new FFT(N_FFT);
  const re = new Float32Array(N_FFT), im = new Float32Array(N_FFT);

  // Reflect padding at both ends, like torch's centred STFT.
  const at = (x: Float32Array, i: number) => {
    let j = i < 0 ? -i : i;
    if (j >= len) j = 2 * (len - 1) - j;
    return x[Math.min(len - 1, Math.max(0, j))] ?? 0;
  };

  const out = Array.from({ length: SOURCES }, () => [new Int16Array(len), new Int16Array(len)]);
  // Overlap-add accumulators cover [base, base + ACC); samples before `base` are final.
  const ACC = C * HOP + N_FFT;
  const acc = Array.from({ length: SOURCES }, () => [new Float32Array(ACC), new Float32Array(ACC)]);
  let base = -PAD;

  // Squared-window sum at sample s, for undoing the overlap-add gain (at most four frames cover a sample).
  const norm = (s: number) => {
    let n = 0;
    const p = s + PAD;
    for (let t = Math.max(0, Math.ceil((p - N_FFT + 1) / HOP)), last = Math.min(T - 1, Math.floor(p / HOP)); t <= last; t++) {
      const w = WIN[p - t * HOP];
      n += w * w;
    }
    return n;
  };

  const finalize = (upTo: number) => {
    const end = Math.min(upTo, len);
    for (let s = Math.max(0, base); s < end; s++) {
      const k = 1 / Math.max(norm(s), 1e-8), i = s - base;
      for (let src = 0; src < SOURCES; src++) {
        for (let c = 0; c < 2; c++) {
          const v = acc[src][c][i] * k;
          out[src][c][s] = v >= 1 ? 32767 : v <= -1 ? -32767 : Math.round(v * 32767);
        }
      }
    }
    const shift = upTo - base;
    for (const pair of acc) for (const a of pair) { a.copyWithin(0, shift); a.fill(0, ACC - shift); }
    base = upTo;
  };

  for (let a = 0; a < T; a += C) {
    const s0 = Math.max(0, a - M), s1 = Math.min(T, a + C + M), n = s1 - s0;
    // Both channels in one complex FFT: left as the real part, right as the imaginary part.
    const xr = [new Float32Array(BINS * n), new Float32Array(BINS * n)];
    const xi = [new Float32Array(BINS * n), new Float32Array(BINS * n)];
    const mag = new Float32Array(2 * BINS * n);
    for (let j = 0; j < n; j++) {
      const start = (s0 + j) * HOP - PAD;
      for (let i = 0; i < N_FFT; i++) { re[i] = at(left, start + i) * WIN[i]; im[i] = at(right, start + i) * WIN[i]; }
      fft.transform(re, im);
      for (let k = 0; k < BINS; k++) {
        const m = (N_FFT - k) % N_FFT;
        const lr = (re[k] + re[m]) / 2, li = (im[k] - im[m]) / 2;
        const rr = (im[k] + im[m]) / 2, ri = (re[m] - re[k]) / 2;
        const q = k * n + j;
        xr[0][q] = lr; xi[0][q] = li; xr[1][q] = rr; xi[1][q] = ri;
        mag[q] = Math.hypot(lr, li);
        mag[BINS * n + q] = Math.hypot(rr, ri);
      }
    }
    const est = await model(mag, n);
    if (est.length !== SOURCES * 2 * BINS * n) throw new Error(`Model returned ${est.length} values, expected ${SOURCES * 2 * BINS * n}`);

    const keep = Math.min(C, T - a);
    for (let j = a - s0; j < a - s0 + keep; j++) {
      const offset = (s0 + j) * HOP - PAD - base;
      for (let src = 0; src < SOURCES; src++) {
        // Both channels of this source in one inverse transform, packed the same way.
        for (let k = 0; k < BINS; k++) {
          const q = k * n + j;
          let mL = 0, mR = 0, sumL = 0, sumR = 0;
          for (let o2 = 0; o2 < SOURCES; o2++) { sumL += est[(o2 * 2) * BINS * n + q]; sumR += est[(o2 * 2 + 1) * BINS * n + q]; }
          // Where the model hears nothing in any source, split the mix evenly so the stems still add up to it.
          mL = sumL > 1e-8 ? est[(src * 2) * BINS * n + q] / sumL : 1 / SOURCES;
          mR = sumR > 1e-8 ? est[(src * 2 + 1) * BINS * n + q] / sumR : 1 / SOURCES;
          const lr = xr[0][q] * mL, li = xi[0][q] * mL, rr = xr[1][q] * mR, ri = xi[1][q] * mR;
          // Z = L + iR; conjugated for an inverse transform through the forward FFT.
          re[k] = lr - ri; im[k] = -(li + rr);
          if (k > 0 && k < BINS - 1) { re[N_FFT - k] = lr + ri; im[N_FFT - k] = li - rr; }
        }
        fft.transform(re, im);
        const aL = acc[src][0], aR = acc[src][1];
        for (let i = 0; i < N_FFT; i++) {
          aL[offset + i] += (re[i] / N_FFT) * WIN[i];
          aR[offset + i] -= (im[i] / N_FFT) * WIN[i];
        }
      }
    }
    finalize(a + keep < T ? (a + keep) * HOP - PAD : len);
    o.onProgress?.(a + keep, T);
  }
  return out;
}
