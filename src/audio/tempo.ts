/**
 * Single-tempo beat grid estimation: one BPM and the time of the first beat.
 *
 * The song is turned into an onset envelope (positive spectral flux on a log
 * magnitude spectrum, 200 frames per second), whose autocorrelation gives the
 * beat period. A prior centred on 120 BPM breaks the usual half/double-tempo
 * tie, and the period and phase are then refined by fitting a comb of beats to
 * the whole envelope. Songs that change tempo drift from a single grid.
 */

export interface TempoEstimate {
  bpm: number;
  /** Seconds to the first beat, in [0, 60 / bpm). */
  offset: number;
  /** 0..1: how strongly the envelope repeats at the chosen period. Low values mean a weak or absent beat. */
  confidence: number;
}

const FPS = 200;
const N = 1024;
const MIN_BPM = 60, MAX_BPM = 200;

export interface Onsets {
  /** Positive spectral flux up to 8 kHz: every kind of onset. Used for the tempo. */
  full: Float32Array;
  /** The same below 150 Hz: kicks and bass notes, which usually sit on the beat. Used for the phase. */
  low: Float32Array;
}

/** Removes a moving average (about 0.25 s) so sustained loudness doesn't count as onsets. */
function highPass(env: Float32Array): Float32Array {
  const frames = env.length, w = Math.round(FPS * 0.125), out = new Float32Array(frames);
  let sum = 0;
  for (let i = 0; i < Math.min(frames, w); i++) sum += env[i];
  for (let i = 0; i < frames; i++) {
    if (i + w < frames) sum += env[i + w];
    if (i - w - 1 >= 0) sum -= env[i - w - 1];
    const n = Math.min(frames, i + w + 1) - Math.max(0, i - w);
    out[i] = Math.max(0, env[i] - sum / n);
  }
  return out;
}

/** Positive spectral flux per frame, with the local mean removed, at FPS frames per second. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): Onsets {
  const hop = sampleRate / FPS;
  const frames = Math.max(0, Math.floor((mono.length - N) / hop) + 1);
  const env = new Float32Array(frames), lowEnv = new Float32Array(frames);
  const lowBin = Math.max(2, Math.ceil((150 * N) / sampleRate));
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const maxBin = Math.min(N / 2, Math.ceil((8000 * N) / sampleRate));
  let prev = new Float32Array(maxBin), cur = new Float32Array(maxBin);
  for (let f = 0; f < frames; f++) {
    const start = Math.round(f * hop);
    for (let i = 0; i < N; i++) { re[i] = mono[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0, low = 0;
    for (let k = 1; k < maxBin; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = f > 0 ? Math.max(0, cur[k] - prev[k]) : 0;
      flux += d;
      if (k < lowBin) low += d;
    }
    env[f] = flux;
    lowEnv[f] = low;
    [prev, cur] = [cur, prev];
  }
  return { full: highPass(env), low: highPass(lowEnv) };
}

/** Linear interpolation into the envelope at a fractional frame. */
const at = (e: Float32Array, x: number) => {
  const i = Math.floor(x), f = x - i;
  return i < 0 || i + 1 >= e.length ? 0 : e[i] * (1 - f) + e[i + 1] * f;
};

/** Best phase (in frames) for a beat period, and the mean envelope on those beats. */
function fitComb(e: Float32Array, period: number) {
  let best = { phase: 0, score: -1 };
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0, n = 0;
    for (let x = ph; x < e.length; x += period) { s += at(e, x); n++; }
    const score = n ? s / n : 0;
    if (score > best.score) best = { phase: ph, score };
  }
  return best;
}

/** Sum of two envelopes, each scaled to a mean of 1, so neither dominates by loudness alone. */
function blend(a: Float32Array, b: Float32Array): Float32Array {
  const mean = (e: Float32Array) => e.reduce((s, v) => s + v, 0) / Math.max(1, e.length) || 1;
  const ma = mean(a), mb = mean(b), out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / ma + b[i] / mb;
  return out;
}

/** Seconds between an onset and the envelope frame where it peaks (frames are stamped at their window's start). */
const latency = (sampleRate: number) => (0.78 * N) / sampleRate;

export function estimateTempo(onsets: Onsets, sampleRate: number): TempoEstimate | null {
  const env = onsets.full;
  const minLag = Math.floor((60 * FPS) / MAX_BPM), maxLag = Math.ceil((60 * FPS) / MIN_BPM);
  if (env.length < maxLag * 4) return null;
  let energy = 0;
  for (let i = 0; i < env.length; i++) energy += env[i] * env[i];
  if (energy <= 1e-9) return null;

  // Autocorrelation, normalised by overlap length.
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag >> 1; lag < ac.length; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (env.length - lag);
  }
  const zero = energy / env.length;
  // Reward periods whose double also repeats, and lean towards 120 BPM (log-Gaussian, one octave wide).
  let bestLag = 0, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = (ac[lag] + 0.5 * (ac[2 * lag] ?? 0)) * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Parabolic interpolation for a fractional period.
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
  const d = a - 2 * b + c;
  let period = bestLag + (d < 0 ? (0.5 * (a - c)) / d : 0);

  // Refine the period over ±2% by fitting beats to the whole song, which pins down long-song drift.
  // The fit leans on the low band, so the grid lands on kicks rather than the hi-hats between them.
  const comb = blend(env, onsets.low);
  let fit = fitComb(comb, period);
  for (let k = -40; k <= 40; k++) {
    const p = period * (1 + k * 0.0005);
    const f = fitComb(comb, p);
    if (f.score > fit.score) { fit = f; period = p; }
  }
  const bpm = (60 * FPS) / period;
  const beat = 60 / bpm;
  let offset = (fit.phase / FPS + latency(sampleRate)) % beat;
  if (offset < 0) offset += beat;
  // A phase just under one beat is a beat at (or a hair before) zero: report 0 rather than a whole beat late.
  if (offset > beat - 0.02) offset = 0;
  const confidence = Math.max(0, Math.min(1, (b - zero * 0.05) / (zero + 1e-9)));
  return { bpm, offset, confidence };
}

/** Downmixes channels and estimates tempo; null when the audio is too short or silent. */
export function detectTempo(channels: Float32Array[], sampleRate: number): TempoEstimate | null {
  const len = channels[0]?.length ?? 0;
  // Above 32 kHz, average sample pairs: half the work, and the envelope only looks below 8 kHz anyway.
  const k = sampleRate > 32000 ? 2 : 1, n = Math.floor(len / k), mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n * k; i++) mono[(i / k) | 0] += ch[i] / (channels.length * k);
  return estimateTempo(onsetEnvelope(mono, sampleRate / k), sampleRate / k);
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
