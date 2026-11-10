import type { AudioFrame, AudioTrack } from '../audio/analysis';
import { cueAt, type LyricCue } from '../audio/lyrics';
import type {
  ImageProps, VideoProps, LyricsProps, SocialsProps, SolidProps, SpectrumProps, TextStyle, TextProps, VuProps, WaveformProps,
} from '../types';
import { resolveFont } from '../fonts';
import { SOCIAL_ICONS, iconPath } from './icons';

export interface Box { x: number; y: number; w: number; h: number }

/** Per-frame inputs shared by every layer. */
export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  t: number;
  dt: number;
  /** Pixel scale: 1 at 1080 on the short side. */
  u: number;
  frame: AudioFrame;
  track: AudioTrack | null;
  preview: boolean;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

function placeholder(d: DrawCtx, b: Box, label: string) {
  if (!d.preview) return;
  const { ctx, u } = d;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([10 * u, 8 * u]);
  ctx.lineWidth = 2 * u;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `${Math.max(12, 26 * u)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2, b.w * 0.9);
  ctx.restore();
}

// ---- solid ------------------------------------------------------------------
export function drawSolid(d: DrawCtx, b: Box, p: SolidProps) {
  const { ctx } = d;
  if (p.gradient) {
    const a = (p.angle * Math.PI) / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const r = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, p.color);
    g.addColorStop(1, p.color2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = p.color;
  ctx.fillRect(b.x, b.y, b.w, b.h);
}

/** Source and destination rectangles for drawing a iw×ih picture into a box. */
function fitRects(b: Box, iw: number, ih: number, fit: 'contain' | 'cover' | 'stretch') {
  let dx = b.x, dy = b.y, dw = b.w, dh = b.h, sx = 0, sy = 0, sw = iw, sh = ih;
  if (fit === 'contain') {
    const k = Math.min(b.w / iw, b.h / ih);
    dw = iw * k; dh = ih * k; dx = b.x + (b.w - dw) / 2; dy = b.y + (b.h - dh) / 2;
  } else if (fit === 'cover') {
    const k = Math.max(b.w / iw, b.h / ih);
    sw = b.w / k; sh = b.h / k; sx = (iw - sw) / 2; sy = (ih - sh) / 2;
  }
  return { dx, dy, dw, dh, sx, sy, sw, sh };
}

/** Bass follower with fast attack and slow release. */
function bassFollow(d: DrawCtx, st: { bass?: number }) {
  const target = clamp((d.frame.bass - 0.35) * 2.5);
  const prev = st.bass ?? 0;
  st.bass = target > prev ? prev + (target - prev) * 0.6 : prev * Math.pow(0.9, d.dt * 60);
  return st.bass;
}

// ---- video ------------------------------------------------------------------
/** Where in a looping clip the song time t falls. */
export function clipTime(p: Pick<VideoProps, 'speed' | 'offset'>, duration: number, t: number) {
  if (!(duration > 0)) return 0;
  const v = (p.offset + t * p.speed) % duration;
  return v < 0 ? v + duration : v;
}

export function drawVideo(
  d: DrawCtx, b: Box, p: VideoProps, frame: CanvasImageSource | null, size: { w: number; h: number } | null, st: { bass?: number },
) {
  if (!frame || !size?.w) return placeholder(d, b, p.assetId ? 'Loading video…' : 'Video — upload MP4, MOV or WebM');
  const { ctx } = d;
  const { dx, dy, dw, dh, sx, sy, sw, sh } = fitRects(b, size.w, size.h, p.fit);
  ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
  const pulse = p.pulse * bassFollow(d, st);
  if (pulse > 0.01) {
    // Drawing the frame again additively brightens it on the beat.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, pulse * 0.6);
    ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

// ---- image ------------------------------------------------------------------
export function drawImage(d: DrawCtx, b: Box, p: ImageProps, img: HTMLImageElement | undefined, st: { bass?: number }) {
  if (!img) return placeholder(d, b, 'Image — upload PNG, SVG or JPG');
  const { ctx, u } = d;
  const iw = img.naturalWidth || b.w, ih = img.naturalHeight || b.h;

  const scale = 1 + p.pulse * 0.15 * bassFollow(d, st);

  const { dx, dy, dw, dh, sx, sy, sw, sh } = fitRects(b, iw, ih, p.fit);

  ctx.save();
  const cx = dx + dw / 2, cy = dy + dh / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((d.t * p.spin) / 60) * Math.PI * 2);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  const shaped = p.circle || p.radius > 0;
  const shadow = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = p.shadow * 60 * u;
    ctx.shadowOffsetY = p.shadow * 12 * u;
  };
  if (shaped) {
    const path = new Path2D();
    if (p.circle) path.ellipse(cx, cy, dw / 2, dh / 2, 0, 0, Math.PI * 2);
    else path.roundRect(dx, dy, dw, dh, p.radius * Math.min(dw, dh));
    if (p.shadow > 0) {
      ctx.save(); shadow(); ctx.fillStyle = '#000'; ctx.fill(path); ctx.restore();
    }
    ctx.clip(path);
  } else if (p.shadow > 0) shadow(); // follows the alpha of transparent PNG/SVG logos
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

// ---- text helpers -----------------------------------------------------------
function applyFont(ctx: CanvasRenderingContext2D, s: Pick<TextStyle, 'font' | 'weight' | 'letterSpacing'>, size: number) {
  ctx.font = `${s.weight} ${size}px "${resolveFont(s.font)}", system-ui, sans-serif`;
  ctx.letterSpacing = `${s.letterSpacing * size}px`;
}
function textShadow(d: DrawCtx, shadow: number) {
  if (shadow <= 0) return;
  d.ctx.shadowColor = 'rgba(0,0,0,0.75)';
  d.ctx.shadowBlur = shadow * 24 * d.u;
  d.ctx.shadowOffsetY = shadow * 4 * d.u;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Largest font size at which the text wraps into the box. */
function fitWrapped(ctx: CanvasRenderingContext2D, s: TextStyle, text: string, w: number, h: number, maxLines: number) {
  let size = h / 1.2;
  for (let i = 0; i < 40; i++) {
    applyFont(ctx, s, size);
    const lines = wrap(ctx, text, w);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= maxLines && lines.length * size * 1.2 <= h && widest <= w) return { size, lines };
    size *= 0.92;
  }
  applyFont(ctx, s, size);
  return { size, lines: wrap(ctx, text, w) };
}

function alignX(b: Box, align: TextStyle['align']) {
  return align === 'left' ? b.x : align === 'right' ? b.x + b.w : b.x + b.w / 2;
}

// ---- text -------------------------------------------------------------------
export function drawText(d: DrawCtx, b: Box, p: TextProps) {
  const { ctx } = d;
  const text = p.uppercase ? p.text.toUpperCase() : p.text;
  if (!text.trim()) return;
  const explicit = text.split('\n').length;
  const { size, lines } = fitWrapped(ctx, p, text, b.w, b.h, Math.max(explicit, 3));
  ctx.fillStyle = p.color;
  ctx.textAlign = p.align;
  ctx.textBaseline = 'middle';
  textShadow(d, p.shadow);
  const top = b.y + b.h / 2 - ((lines.length - 1) * size * 1.2) / 2;
  lines.forEach((l, i) => ctx.fillText(l, alignX(b, p.align), top + i * size * 1.2));
}

// ---- lyrics -----------------------------------------------------------------
function sungChars(cue: LyricCue, t: number): number {
  if (!cue.words?.length) return cue.text.length * clamp((t - cue.start) / Math.max(0.1, cue.end - cue.start));
  let chars = 0;
  for (let i = 0; i < cue.words.length; i++) {
    const w = cue.words[i], len = w.text.trim().length;
    if (t < w.t) break;
    const next = cue.words[i + 1]?.t ?? cue.end;
    const frac = clamp((t - w.t) / Math.max(0.05, next - w.t));
    chars += frac * len + (frac >= 1 ? 1 : 0);
    if (frac < 1) break;
  }
  return chars;
}

export function drawLyrics(d: DrawCtx, b: Box, p: LyricsProps, cues: LyricCue[] | undefined) {
  if (!cues?.length) return placeholder(d, b, 'Lyrics — upload .lrc, .srt or .vtt');
  const { ctx } = d;
  const t = d.t - p.offset;
  let i = cueAt(cues, t);
  // Between lines, show the upcoming one dimmed when it is close.
  const upcoming = i < 0 ? cues.findIndex((c) => c.start > t) : -1;
  if (i < 0 && upcoming >= 0 && cues[upcoming].start - t < 1.5 && p.mode !== 'line') i = upcoming;
  if (i < 0) return;
  const cue = cues[i];
  const tx = (s: string) => (p.uppercase ? s.toUpperCase() : s);

  const fadeIn = p.fade > 0 ? clamp((t - cue.start + 0.001) / p.fade) : 1;
  const fadeOut = p.fade > 0 ? clamp((cue.end - t) / p.fade) : 1;
  const active = t >= cue.start;
  ctx.textAlign = p.align;
  ctx.textBaseline = 'middle';
  textShadow(d, p.shadow);

  const mainBox = p.mode === 'line+next' ? { ...b, h: b.h * 0.62 } : b;
  const { size, lines } = fitWrapped(ctx, p, tx(cue.text), mainBox.w, mainBox.h, 2);
  const top = mainBox.y + mainBox.h / 2 - ((lines.length - 1) * size * 1.2) / 2;
  const x = alignX(b, p.align);
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * (active ? Math.min(fadeIn, fadeOut) : 0.6);

  if (p.mode === 'karaoke' && active) {
    let remaining = sungChars(cue, t);
    lines.forEach((line, li) => {
      const y = top + li * size * 1.2;
      ctx.fillStyle = p.dimColor;
      ctx.fillText(line, x, y);
      const n = clamp(remaining, 0, line.length);
      remaining -= line.length + 1;
      if (n <= 0) return;
      const full = ctx.measureText(line).width;
      const whole = Math.floor(n);
      const partW = ctx.measureText(line.slice(0, whole)).width
        + (whole < line.length ? (n - whole) * ctx.measureText(line[whole]).width : 0);
      const left = p.align === 'left' ? x : p.align === 'right' ? x - full : x - full / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - size, y - size, partW + size, size * 2);
      ctx.clip();
      ctx.fillStyle = p.highlight;
      ctx.fillText(line, x, y);
      ctx.restore();
    });
  } else {
    ctx.fillStyle = active ? p.color : p.dimColor;
    lines.forEach((line, li) => ctx.fillText(line, x, top + li * size * 1.2));
  }

  const next = cues[i + 1];
  if (p.mode === 'line+next' && next && next.start - cue.end < 4) {
    ctx.globalAlpha = base * 0.8;
    const nb = { ...b, y: b.y + b.h * 0.66, h: b.h * 0.34 };
    const r = fitWrapped(ctx, p, tx(next.text), nb.w, nb.h, 1);
    ctx.fillStyle = p.dimColor;
    ctx.fillText(r.lines[0], x, nb.y + nb.h / 2);
  }
  ctx.globalAlpha = base;
}

// ---- socials ----------------------------------------------------------------
export function drawSocials(d: DrawCtx, b: Box, p: SocialsProps) {
  const { ctx } = d;
  const items = p.items.filter((i) => i.handle.trim() || i.platform);
  if (!items.length) return;
  const rows = p.layout === 'column' ? items.map((i) => [i]) : [items];
  const rowH = b.h / rows.length;

  // Measure at a nominal size, then scale everything to fit the box.
  const nominal = 100, gap = nominal * 0.6, iconGap = nominal * 0.25;
  applyFont(ctx, p, nominal * 0.62);
  const widths = new Map(items.map((i) => [i, nominal * 0.8 + (i.handle ? iconGap + ctx.measureText(i.handle).width : 0)]));
  const rowWidths = rows.map((r) => r.reduce((s, i) => s + widths.get(i)!, 0) + gap * (r.length - 1));
  const k = Math.min(rowH / (nominal * 1.1), b.w / Math.max(...rowWidths));

  textShadow(d, p.shadow);
  applyFont(ctx, p, nominal * 0.62 * k);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  rows.forEach((row, ri) => {
    const cy = b.y + rowH * (ri + 0.5);
    let x = b.x + (b.w - rowWidths[ri] * k) / 2;
    for (const item of row) {
      const s = nominal * 0.8 * k;
      const icon = SOCIAL_ICONS[item.platform];
      // Black brand marks (TikTok, X, Threads) would vanish on dark video; fall back to the text colour.
      ctx.fillStyle = p.brandColors && luminance(icon.hex) > 0.12 ? icon.hex : p.brandColors ? p.color : p.iconColor;
      ctx.save();
      ctx.translate(x, cy - s / 2);
      ctx.scale(s / 24, s / 24);
      ctx.fill(iconPath(item.platform));
      ctx.restore();
      if (item.handle) {
        ctx.fillStyle = p.color;
        ctx.fillText(item.handle, x + s + iconGap * k, cy);
      }
      x += (widths.get(item)! + gap) * k;
    }
  });
}

// ---- waveform ---------------------------------------------------------------
export function drawWaveform(d: DrawCtx, b: Box, p: WaveformProps) {
  const { ctx, u } = d;
  ctx.lineWidth = p.thickness * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.glow > 0) { ctx.shadowColor = p.color; ctx.shadowBlur = p.glow * 30 * u; }
  const cy = b.y + b.h / 2;

  if (p.mode === 'progress') {
    const track = d.track;
    if (!track) return placeholder(d, b, 'Progress waveform — add a song');
    const n = p.style === 'bars' ? Math.max(8, Math.floor(b.w / (p.thickness * u * 2.2))) : Math.floor(b.w / (2 * u));
    const played = clamp(d.t / track.duration);
    const ov = track.overview, per = ov.length / n;
    const amp = (i: number) => {
      let m = 0;
      for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) m = Math.max(m, ov[j]);
      return clamp(m * p.gain);
    };
    const paint = (fill: string, from: number, to: number) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x + from * b.w, b.y - b.h, (to - from) * b.w, b.h * 3); ctx.clip();
      ctx.fillStyle = ctx.strokeStyle = fill;
      if (p.style === 'bars') {
        const bw = b.w / n;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const a = Math.max(p.thickness * u, amp(i) * b.h);
          ctx.roundRect(b.x + i * bw + bw * 0.2, cy - a / 2, bw * 0.6, a, bw * 0.3);
        }
        ctx.fill();
      } else {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) ctx.lineTo(b.x + (i / n) * b.w, cy - (amp(i) * b.h) / 2);
        if (p.style === 'mirror') {
          for (let i = n; i >= 0; i--) ctx.lineTo(b.x + (i / n) * b.w, cy + (amp(i) * b.h) / 2);
          ctx.closePath(); ctx.fill();
        } else ctx.stroke();
      }
      ctx.restore();
    };
    paint(p.playedColor, 0, played);
    paint(p.color, played, 1);
    return;
  }

  // Live oscilloscope of the current audio window.
  const s = d.frame.mono;
  ctx.strokeStyle = ctx.fillStyle = p.color;
  if (p.style === 'bars') {
    const n = Math.max(8, Math.floor(b.w / (p.thickness * u * 2.5)));
    const per = Math.floor(s.length / n), bw = b.w / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * per; j < (i + 1) * per; j++) m = Math.max(m, Math.abs(s[j]));
      const a = Math.max(p.thickness * u, clamp(m * p.gain) * b.h);
      ctx.roundRect(b.x + i * bw + bw * 0.2, cy - a / 2, bw * 0.6, a, bw * 0.3);
    }
    ctx.fill();
    return;
  }
  const n = Math.min(s.length, Math.floor(b.w / (2 * u)));
  const step = s.length / n;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = clamp(s[Math.floor(i * step)] * p.gain, -1, 1);
    const y = p.style === 'mirror' ? cy - (Math.abs(v) * b.h) / 2 : cy - (v * b.h) / 2;
    ctx.lineTo(b.x + (i / (n - 1)) * b.w, y);
  }
  if (p.style === 'mirror') {
    for (let i = n - 1; i >= 0; i--) {
      const v = clamp(Math.abs(s[Math.floor(i * step)] * p.gain));
      ctx.lineTo(b.x + (i / (n - 1)) * b.w, cy + (v * b.h) / 2);
    }
    ctx.closePath(); ctx.fill();
  } else ctx.stroke();
}

// ---- spectrum ---------------------------------------------------------------
/** Base-ten octave ratio (IEC 61260), which gives the familiar ISO centres 20, 25, 31.5, 40 … 20k Hz. */
const OCTAVE = Math.pow(10, 0.3);

/**
 * Frequency edges of each bar, in Hz. 'count' splits minHz..maxHz into `bars`
 * equal steps on a log scale. The octave options use 1/3- or 1/6-octave bands
 * centred on 1 kHz and keep every band that overlaps minHz..maxHz, so 20 Hz to
 * 20 kHz at 1/3 octave gives the 31 ISO bands from 20 Hz to 20 kHz.
 */
export function spectrumBands(p: Pick<SpectrumProps, 'bars' | 'minHz' | 'maxHz' | 'spacing'>): [number, number][] {
  if (p.spacing === 'octave-1/3' || p.spacing === 'octave-1/6') {
    const b = p.spacing === 'octave-1/3' ? 3 : 6, half = Math.pow(OCTAVE, 1 / (2 * b));
    const out: [number, number][] = [];
    const k0 = Math.floor(b * Math.log(Math.max(1, p.minHz) / 1000) / Math.log(OCTAVE)) - 1;
    for (let k = k0; ; k++) {
      const fc = 1000 * Math.pow(OCTAVE, k / b), lo = fc / half, hi = fc * half;
      if (lo >= p.maxHz) break;
      if (hi > p.minHz) out.push([lo, hi]);
    }
    if (out.length) return out;
  }
  const n = Math.max(4, Math.round(p.bars));
  const lo = Math.log(Math.max(10, p.minHz)), hi = Math.log(Math.max(p.minHz + 10, p.maxHz));
  return Array.from({ length: n }, (_, i) => [Math.exp(lo + ((hi - lo) * i) / n), Math.exp(lo + ((hi - lo) * (i + 1)) / n)]);
}

interface SpectrumState {
  bars?: Float32Array; bandKey?: string; bands?: [number, number][];
  peaks?: Float32Array; held?: Float32Array; scratch?: HTMLCanvasElement;
}

export function spectrumBars(d: DrawCtx, p: SpectrumProps, st: SpectrumState) {
  const f = d.frame, bins = f.spectrum, hz = f.sampleRate / (bins.length * 2);
  const key = `${p.spacing}|${p.bars}|${p.minHz}|${p.maxHz}`;
  if (st.bandKey !== key) { st.bands = spectrumBands(p); st.bandKey = key; }
  const bands = st.bands!, n = bands.length;
  if (st.bars?.length !== n) st.bars = new Float32Array(n);
  const keep = Math.pow(clamp(p.smoothing, 0, 0.98), d.dt * 60);
  for (let i = 0; i < n; i++) {
    const a = bands[i][0] / hz, bEnd = bands[i][1] / hz;
    let v = 0;
    if (bEnd - a < 1) {
      const c = (a + bEnd) / 2, k = Math.floor(c), fr = c - k;
      v = (bins[k] ?? 0) * (1 - fr) + (bins[k + 1] ?? 0) * fr;
    } else for (let k = Math.floor(a); k <= Math.ceil(bEnd) && k < bins.length; k++) v = Math.max(v, bins[k]);
    // Music sits roughly -60..-10 dBFS; stretch that range and add a little tilt toward treble.
    const tilt = 1 + (i / n) * 0.25;
    const target = clamp(Math.pow(clamp((v * tilt - 0.3) / 0.6), 1.4) * p.sensitivity);
    const prev = st.bars[i];
    st.bars[i] = target > prev ? prev + (target - prev) * 0.75 : prev * keep + target * (1 - keep);
  }
  return st.bars;
}

/** Seconds a peak cap waits at its highest point, and how fast it then falls, in bar heights per second. */
export const PEAK_HOLD = 0.6, PEAK_FALL = 1.2;

/**
 * Moves each peak cap one frame forward. Caps jump up with their bar, hold for
 * PEAK_HOLD seconds, then fall at PEAK_FALL per second. Everything is scaled by
 * dt, so exports at 24, 30 and 60 fps fall at the same speed.
 */
export function stepPeaks(levels: Float32Array, peaks: Float32Array, held: Float32Array, dt: number) {
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] >= peaks[i]) { peaks[i] = levels[i]; held[i] = PEAK_HOLD; }
    else if (held[i] > 0) held[i] -= dt;
    else peaks[i] = Math.max(levels[i], peaks[i] - PEAK_FALL * dt);
  }
}

/** Adds the bars (plain or LED) and peak caps of the 'bars' style to two paths, lit and unlit. */
function barShapes(p: SpectrumProps, v: Float32Array, peaks: Float32Array | undefined, b: Box, u: number) {
  const n = v.length, slot = b.w / n, bw = slot * (1 - clamp(p.gap, 0, 0.9));
  const r = p.rounded ? Math.min(bw / 2, 20 * u) : 0;
  const lit = new Path2D(), dim = new Path2D();
  const segs = Math.max(4, Math.round(p.segments)), sh = b.h / segs, sg = sh * 0.25;
  for (let i = 0; i < n; i++) {
    const x = b.x + i * slot + (slot - bw) / 2;
    if (p.led) {
      const on = Math.round(v[i] * segs), pk = peaks ? Math.min(segs, Math.round(peaks[i] * segs)) : 0;
      for (let s = 0; s < segs; s++) {
        const y = b.y + b.h - (s + 1) * sh + sg / 2;
        (s < on || (pk > 0 && s === pk - 1) ? lit : dim).rect(x, y, bw, sh - sg);
      }
      continue;
    }
    const h = Math.max(2 * u, v[i] * b.h);
    lit.roundRect(x, b.y + b.h - h, bw, h, [r, r, 0, 0]);
    if (peaks && peaks[i] > 0.01) {
      const ch = Math.max(2 * u, b.h * 0.018), y = b.y + b.h - Math.max(peaks[i] * b.h, h) - ch * 1.6;
      lit.rect(x, Math.max(b.y, y), bw, ch);
    }
  }
  return { lit, dim, led: p.led };
}

export function drawSpectrum(d: DrawCtx, b: Box, p: SpectrumProps, st: SpectrumState) {
  const { ctx, u } = d;
  const v = spectrumBars(d, p, st), n = v.length;
  if (p.glow > 0) { ctx.shadowColor = p.color; ctx.shadowBlur = p.glow * 30 * u; }
  const grad = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
  grad.addColorStop(0, p.color);
  grad.addColorStop(1, p.color2);
  ctx.fillStyle = ctx.strokeStyle = grad;

  if (p.style === 'radial') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.min(b.w, b.h) / 2;
    const inner = R * 0.55, len = R - inner;
    const bw = ((2 * Math.PI * inner) / n) * (1 - clamp(p.gap, 0, 0.9));
    // One path and one fill, so the glow blur runs once rather than per bar.
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    g.addColorStop(0, p.color); g.addColorStop(0.5, p.color2); g.addColorStop(1, p.color);
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      // Mirror left/right so the ring is symmetrical.
      const val = v[Math.min(n - 1, 2 * (i < n / 2 ? i : n - 1 - i))];
      const l = Math.max(2 * u, val * len);
      const bar = new Path2D();
      bar.roundRect(-bw / 2, -inner - l, bw, l, p.rounded ? bw / 2 : 0);
      path.addPath(bar, new DOMMatrix().translate(cx, cy).rotate((i / n) * 360));
    }
    ctx.fillStyle = g;
    ctx.fill(path);
    return;
  }
  if (p.style === 'line') {
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h);
    for (let i = 0; i < n; i++) {
      const x0 = b.x + (i / (n - 1)) * b.w, y0 = b.y + b.h - v[i] * b.h;
      if (i === 0) ctx.lineTo(x0, y0);
      else {
        const xp = b.x + ((i - 1) / (n - 1)) * b.w, yp = b.y + b.h - v[i - 1] * b.h;
        ctx.bezierCurveTo((xp + x0) / 2, yp, (xp + x0) / 2, y0, x0, y0);
      }
    }
    ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.save(); ctx.globalAlpha *= 0.35; ctx.fill(); ctx.restore();
    ctx.stroke();
    return;
  }
  if (p.style === 'mirror') {
    const slot = b.w / n, bw = slot * (1 - clamp(p.gap, 0, 0.9));
    const r = p.rounded ? Math.min(bw / 2, 20 * u) : 0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = b.x + i * slot + (slot - bw) / 2;
      const h = Math.max(bw, v[i] * b.h);
      ctx.roundRect(x, b.y + (b.h - h) / 2, bw, h, r);
    }
    ctx.fill();
    return;
  }

  // Bars: the reflection, when on, takes the lower part of the box.
  let peaks: Float32Array | undefined;
  if (p.peaks) {
    if (st.peaks?.length !== n) { st.peaks = new Float32Array(n); st.held = new Float32Array(n); }
    stepPeaks(v, st.peaks, st.held!, d.dt);
    peaks = st.peaks;
  }
  const refl = clamp(p.reflection);
  const bars: Box = refl > 0 ? { ...b, h: b.h * 0.7 } : b;
  const shapes = barShapes(p, v, peaks, bars, u);
  ctx.fill(shapes.lit);
  if (shapes.led) {
    ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha *= 0.12; ctx.fill(shapes.dim); ctx.restore();
  }
  if (refl > 0) drawReflection(d, b, bars, p, shapes, refl, st);
}

/** Mirrors the bars below their baseline into the rest of the box, fading out downwards. */
function drawReflection(
  d: DrawCtx, b: Box, bars: Box, p: SpectrumProps, shapes: ReturnType<typeof barShapes>, strength: number, st: SpectrumState,
) {
  const { ctx } = d;
  const rh = b.y + b.h - (bars.y + bars.h);
  const w = Math.max(1, Math.ceil(b.w)), h = Math.max(1, Math.ceil(rh));
  const c = (st.scratch ??= document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  // Flip around the baseline: bar y = bars.y + bars.h maps to scratch y = 0.
  g.setTransform(1, 0, 0, -1, -b.x, bars.y + bars.h);
  const grad = g.createLinearGradient(b.x, 0, b.x + b.w, 0);
  grad.addColorStop(0, p.color);
  grad.addColorStop(1, p.color2);
  g.fillStyle = grad;
  g.fill(shapes.lit);
  if (shapes.led) { g.globalAlpha = 0.12; g.fill(shapes.dim); g.globalAlpha = 1; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, `rgba(0,0,0,${0.6 * strength})`);
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.drawImage(c, b.x, bars.y + bars.h, w, h);
  ctx.restore();
}

// ---- VU meter ---------------------------------------------------------------
interface VuState { level?: [number, number]; peak?: [number, number]; held?: [number, number] }

export function drawVu(d: DrawCtx, b: Box, p: VuProps, st: VuState) {
  const { ctx, u, frame, dt } = d;
  const toMeter = (rms: number) => clamp((20 * Math.log10(rms * p.sensitivity * 1.41 + 1e-6) + 42) / 42);
  const target: [number, number] = [toMeter(frame.rmsL), toMeter(frame.rmsR)];
  st.level ??= [0, 0]; st.peak ??= [0, 0]; st.held ??= [0, 0];
  const needle = p.style === 'needle';
  for (let c = 0; c < 2; c++) {
    const prev = st.level[c];
    // Needles are damped like an analogue meter; LEDs attack almost instantly.
    const attack = needle ? 1 - Math.pow(0.8, dt * 60) : 0.8;
    st.level[c] = target[c] > prev ? prev + (target[c] - prev) * attack : Math.max(target[c], prev - dt * (needle ? 1.2 : 1.6));
    if (st.level[c] >= st.peak[c]) { st.peak[c] = st.level[c]; st.held[c] = 1; }
    else if ((st.held[c] -= dt) <= 0) st.peak[c] = Math.max(0, st.peak[c] - dt * 0.8);
  }
  const zone = (k: number) => (k < 0.6 ? p.low : k < 0.85 ? p.mid : p.high);

  if (needle) {
    const wide = b.w >= b.h;
    for (let c = 0; c < 2; c++) {
      const cb = wide ? { x: b.x + (c * b.w) / 2, y: b.y, w: b.w / 2, h: b.h } : { x: b.x, y: b.y + (c * b.h) / 2, w: b.w, h: b.h / 2 };
      const R = Math.min(cb.w * 0.45, cb.h * 0.8), cx = cb.x + cb.w / 2, cy = cb.y + cb.h / 2 + R * 0.45;
      const a0 = -Math.PI * 0.8, a1 = -Math.PI * 0.2;
      ctx.lineWidth = 4 * u;
      for (let s = 0; s < 3; s++) {
        const from = [0, 0.6, 0.85][s], to = [0.6, 0.85, 1][s];
        ctx.strokeStyle = [p.low, p.mid, p.high][s];
        ctx.beginPath(); ctx.arc(cx, cy, R, a0 + (a1 - a0) * from, a0 + (a1 - a0) * to); ctx.stroke();
      }
      for (let tk = 0; tk <= 10; tk++) {
        const a = a0 + ((a1 - a0) * tk) / 10;
        ctx.strokeStyle = zone(tk / 10);
        ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      }
      const a = a0 + (a1 - a0) * st.level[c];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(cx, cy, 6 * u, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }

  const vertical = p.orientation === 'vertical';
  const along = vertical ? b.h : b.w, across = (vertical ? b.w : b.h) / 2;
  for (let c = 0; c < 2; c++) {
    const level = st.level[c];
    const lane = (from: number, to: number) => {
      const o = c * across + across * 0.12, t = across * 0.76;
      return vertical
        ? { x: b.x + o, y: b.y + b.h - to * along, w: t, h: (to - from) * along }
        : { x: b.x + from * along, y: b.y + o, w: (to - from) * along, h: t };
    };
    if (p.style === 'led') {
      const n = Math.max(4, Math.round(p.segments)), gap = 0.18;
      for (let s = 0; s < n; s++) {
        const k = (s + 0.5) / n;
        const r = lane(s / n + gap / n / 2, (s + 1) / n - gap / n / 2);
        ctx.fillStyle = zone(k);
        const lit = level >= s / n + 0.5 / n;
        const isPeak = p.peakHold && Math.abs(st.peak[c] - k) < 0.5 / n;
        ctx.globalAlpha = lit || isPeak ? 1 : 0.12;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.globalAlpha = 1;
    } else {
      const r = lane(0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const g = vertical ? ctx.createLinearGradient(0, b.y + b.h, 0, b.y) : ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
      g.addColorStop(0, p.low); g.addColorStop(0.6, p.low); g.addColorStop(0.75, p.mid); g.addColorStop(1, p.high);
      ctx.fillStyle = g;
      const f = lane(0, level);
      ctx.fillRect(f.x, f.y, f.w, f.h);
      if (p.peakHold && st.peak[c] > 0.01) {
        const pk = lane(Math.max(0, st.peak[c] - 0.012), st.peak[c]);
        ctx.fillStyle = zone(st.peak[c]);
        ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
      }
    }
  }
}
