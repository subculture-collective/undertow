export const WINDOW = 2048;
const BINS = WINDOW / 2;
const OVERVIEW_BUCKETS = 4096;

/** In-place iterative radix-2 FFT for a fixed size. */
class FFT {
  private rev: Uint32Array;
  private cos: Float32Array;
  private sin: Float32Array;

  constructor(private n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  transform(re: Float32Array, im: Float32Array) {
    const { n, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const a = start + k, b = a + half;
          const c = this.cos[k * step], s = this.sin[k * step];
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

const fft = new FFT(WINDOW);
const hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
const hannSum = hann.reduce((a, b) => a + b, 0);

export interface AudioFrame {
  t: number;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  mono: Float32Array;
  /** Per-bin level mapped from -80..0 dBFS to 0..1. */
  spectrum: Float32Array;
  rmsL: number; rmsR: number; peakL: number; peakR: number;
  bass: number; mid: number; treb: number;
}

export function silentFrame(t = 0, sampleRate = 44100): AudioFrame {
  return {
    t, sampleRate,
    left: new Float32Array(WINDOW), right: new Float32Array(WINDOW), mono: new Float32Array(WINDOW),
    spectrum: new Float32Array(BINS),
    rmsL: 0, rmsR: 0, peakL: 0, peakR: 0, bass: 0, mid: 0, treb: 0,
  };
}

export class AudioTrack {
  readonly duration: number;
  readonly sampleRate: number;
  /** Peak amplitude per bucket across the whole song, for progress waveforms. */
  readonly overview: Float32Array;
  private L: Float32Array;
  private R: Float32Array;

  constructor(readonly buffer: AudioBuffer) {
    this.duration = buffer.duration;
    this.sampleRate = buffer.sampleRate;
    this.L = buffer.getChannelData(0);
    this.R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : this.L;
    this.overview = new Float32Array(OVERVIEW_BUCKETS);
    const per = Math.max(1, Math.floor(this.L.length / OVERVIEW_BUCKETS));
    for (let b = 0; b < OVERVIEW_BUCKETS; b++) {
      let m = 0;
      for (let i = b * per, end = Math.min(this.L.length, i + per); i < end; i++) {
        const v = Math.max(Math.abs(this.L[i]), Math.abs(this.R[i]));
        if (v > m) m = v;
      }
      this.overview[b] = m;
    }
  }

  /** Analysis of the window of samples ending at time t. */
  frame(t: number): AudioFrame {
    const f = silentFrame(t, this.sampleRate);
    const end = Math.round(t * this.sampleRate);
    const n = this.L.length;
    let sl = 0, sr = 0, pl = 0, pr = 0;
    const re = new Float32Array(WINDOW), im = new Float32Array(WINDOW);
    for (let k = 0; k < WINDOW; k++) {
      const s = end - WINDOW + k;
      const l = s >= 0 && s < n ? this.L[s] : 0;
      const r = s >= 0 && s < n ? this.R[s] : 0;
      f.left[k] = l; f.right[k] = r; f.mono[k] = (l + r) / 2;
      sl += l * l; sr += r * r;
      pl = Math.max(pl, Math.abs(l)); pr = Math.max(pr, Math.abs(r));
      re[k] = f.mono[k] * hann[k];
    }
    f.rmsL = Math.sqrt(sl / WINDOW); f.rmsR = Math.sqrt(sr / WINDOW);
    f.peakL = pl; f.peakR = pr;

    fft.transform(re, im);
    for (let i = 0; i < BINS; i++) {
      const mag = (2 * Math.hypot(re[i], im[i])) / hannSum;
      const db = 20 * Math.log10(mag + 1e-9);
      f.spectrum[i] = Math.min(1, Math.max(0, (db + 80) / 80));
    }
    const band = (lo: number, hi: number) => {
      const hz = this.sampleRate / WINDOW;
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(BINS - 1, Math.ceil(hi / hz));
      let s = 0;
      for (let i = a; i <= b; i++) s += f.spectrum[i];
      return s / (b - a + 1);
    };
    f.bass = band(20, 250); f.mid = band(250, 4000); f.treb = band(4000, 16000);
    return f;
  }

  /** A copy of the song between two times, for export ranges. */
  slice(start: number, end: number): AudioBuffer {
    const a = Math.floor(start * this.sampleRate), b = Math.min(this.buffer.length, Math.ceil(end * this.sampleRate));
    const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: this.buffer.numberOfChannels, sampleRate: this.sampleRate });
    for (let c = 0; c < this.buffer.numberOfChannels; c++) out.copyToChannel(this.buffer.getChannelData(c).subarray(a, b), c);
    return out;
  }
}

export async function decodeAudio(data: ArrayBuffer): Promise<AudioTrack> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return new AudioTrack(await ctx.decodeAudioData(data));
}
