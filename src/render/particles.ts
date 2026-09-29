import type { ParticlesProps } from '../types';
import type { Box, DrawCtx } from './layers';

/**
 * Particle fields computed from time rather than simulated, so a frame looks
 * the same whether it is reached by playing, seeking or exporting. The only
 * state is a phase that runs faster when the bass hits, and a seek resets it
 * to a time-based value.
 */
interface ParticleState { phase?: number; bass?: number }

/** Stable pseudo-random value in [0, 1) for particle i, channel k. */
function rand(seed: number, i: number, k: number) {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const frac = (v: number) => v - Math.floor(v);
const wrap = (v: number, lo: number, span: number) => lo + frac((v - lo) / span) * span;

/** Soft round sprites, one per colour and hardness, drawn once and scaled per particle. */
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(color: string, hard: number) {
  const key = `${color}|${hard}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(hard, '#fff');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Tint afterwards so any CSS colour works, not just six-digit hex.
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

export function drawParticles(d: DrawCtx, b: Box, p: ParticlesProps, st: ParticleState) {
  const { ctx, u, dt } = d;
  const target = Math.min(1, Math.max(0, (d.frame.bass - 0.35) * 2.5));
  const prevBass = st.bass ?? 0;
  st.bass = target > prevBass ? prevBass + (target - prevBass) * 0.5 : prevBass * Math.pow(0.9, dt * 60);
  const boost = p.react * st.bass;
  st.phase ??= d.t * p.speed;
  st.phase += dt * p.speed * (1 + boost * 2);
  const ph = st.phase;

  const n = Math.max(1, Math.round(p.count));
  const colors = [p.color, p.color2];
  const sizeK = p.size * u * (1 + boost * 0.5);
  const base = ctx.globalAlpha;

  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();

  if (p.style === 'starfield') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.max(b.w, b.h) * 0.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = rand(p.seed, i, 0) * 2 - 1, y = rand(p.seed, i, 1) * 2 - 1;
      // Depth runs from 1 (far) to near 0 (at the viewer), then wraps.
      const z = 1 - frac(rand(p.seed, i, 2) + ph * 0.12);
      const zz = Math.max(0.02, z), tail = Math.min(1, zz + 0.02 + boost * 0.06);
      const sx = cx + (x / zz) * R * 0.25, sy = cy + (y / zz) * R * 0.25;
      const tx = cx + (x / tail) * R * 0.25, ty = cy + (y / tail) * R * 0.25;
      ctx.globalAlpha = base * Math.min(1, (1 - z) * 1.6);
      ctx.strokeStyle = colors[i & 1];
      ctx.lineWidth = Math.max(0.5 * u, (1 - z) * 3.5 * sizeK);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sx, sy); ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const cfg = {
    dust: { minR: 1.2, maxR: 3.5, minV: 12, maxV: 45, hard: 0.35, alpha: 0.9, wobble: 18 },
    bokeh: { minR: 18, maxR: 70, minV: 6, maxV: 22, hard: 0.7, alpha: 0.28, wobble: 30 },
    embers: { minR: 1.5, maxR: 4.5, minV: 40, maxV: 120, hard: 0.3, alpha: 1, wobble: 40 },
    snow: { minR: 2, maxR: 6, minV: 30, maxV: 90, hard: 0.55, alpha: 0.9, wobble: 35 },
  }[p.style];
  const a = (p.direction * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const pad = cfg.maxR * sizeK * 2 + cfg.wobble * u;
  const W = b.w + pad * 2, H = b.h + pad * 2;

  for (let i = 0; i < n; i++) {
    const r1 = rand(p.seed, i, 0), r2 = rand(p.seed, i, 1), r3 = rand(p.seed, i, 2), r4 = rand(p.seed, i, 3);
    // Near particles are bigger and faster, which reads as depth.
    const depth = p.style === 'bokeh' ? r3 : r3 * r3;
    const r = (cfg.minR + (cfg.maxR - cfg.minR) * depth) * sizeK;
    const v = (cfg.minV + (cfg.maxV - cfg.minV) * (0.3 + 0.7 * depth)) * u;
    const sway = Math.sin(ph * (0.4 + r4) + r4 * 20) * cfg.wobble * u * (0.3 + depth);
    let x = b.x - pad + r1 * W + dx * v * ph - dy * sway;
    let y = b.y - pad + r2 * H + dy * v * ph + dx * sway;
    x = wrap(x, b.x - pad, W);
    y = wrap(y, b.y - pad, H);

    let alpha = cfg.alpha * (0.5 + 0.5 * depth);
    let color = colors[r4 < 0.5 ? 0 : 1];
    if (p.style === 'dust') alpha *= 0.55 + 0.45 * Math.sin(ph * (1 + r4 * 3) + r1 * 40);
    if (p.style === 'embers') {
      // Each ember lives a few seconds, brightening and fading, and cools from colour to colour 2.
      const life = frac(ph * (0.15 + r4 * 0.2) + r1);
      alpha *= Math.sin(Math.PI * life) * (0.75 + 0.25 * Math.sin(ph * 25 + i));
      color = life < 0.55 ? p.color : p.color2;
    }
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = base * Math.min(1, alpha);
    ctx.drawImage(sprite(color, cfg.hard), x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.restore();
}
