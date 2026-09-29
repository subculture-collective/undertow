import { silentFrame, type AudioTrack } from '../audio/analysis';
import type { RuntimeAsset } from '../assets';
import type { AspectId, Layer, Project, VideoLayer } from '../types';
import {
  clipTime, drawImage, drawLyrics, drawSocials, drawSolid, drawSpectrum, drawText, drawVideo, drawVu, drawWaveform, type Box, type DrawCtx,
} from './layers';
import { MilkInstance } from './milkdrop';
import { drawParticles } from './particles';

export type DecodedFrame = HTMLCanvasElement | OffscreenCanvas;

export interface RenderInput {
  project: Project;
  aspect: AspectId;
  t: number;
  dt: number;
  track: AudioTrack | null;
  assets: Record<string, RuntimeAsset>;
  /** Shows placeholders for empty layers; off for exports. */
  preview: boolean;
  /** Milkdrop resolution relative to the output, to keep previews smooth. */
  milkScale?: number;
  /** Preview only: whether playback is running, so video layers play rather than seek. */
  playing?: boolean;
  /** Export only: exact decoded frames for video layers, by layer id. Preview plays <video> elements instead. */
  videoFrames?: Map<string, DecodedFrame | null>;
}

/**
 * Draws a project frame by frame. Holds per-layer state (meter ballistics,
 * spectrum smoothing, Milkdrop instances), so use one instance per timeline.
 */
export class Compositor {
  private milk = new Map<string, MilkInstance>();
  private videos = new Map<string, HTMLVideoElement>();
  private drawn = new Set<string>();
  private state = new Map<string, Record<string, unknown>>();
  private lastT = -1;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  render(r: RenderInput) {
    const { ctx } = this;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    // A seek or loop makes smoothed values meaningless; start them fresh.
    if (r.t < this.lastT - 0.05 || r.t - this.lastT > 1) this.state.clear();
    this.lastT = r.t;

    const d: DrawCtx = {
      ctx, t: r.t, dt: r.dt, u: Math.min(W, H) / 1080,
      frame: r.track ? r.track.frame(r.t) : silentFrame(r.t),
      track: r.track, preview: r.preview,
    };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const live = new Set<string>();
    this.drawn.clear();
    for (const layer of r.project.layers) {
      live.add(layer.id);
      if (!layer.visible || layer.opacity <= 0) continue;
      const rect = layer.rects[r.aspect];
      const box: Box = { x: rect.x * W, y: rect.y * H, w: rect.w * W, h: rect.h * H };
      if (box.w < 1 || box.h < 1) continue;
      this.drawn.add(layer.id);
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      try {
        this.drawLayer(d, layer, box, r);
      } catch (e) {
        console.error(`layer ${layer.name} failed`, e);
      }
      ctx.restore();
    }

    for (const [id, m] of this.milk) if (!live.has(id)) { m.dispose(); this.milk.delete(id); }
    for (const [id, v] of this.videos) {
      if (!live.has(id)) { stopVideo(v); this.videos.delete(id); } else if (!this.drawn.has(id)) v.pause();
    }
  }

  /** Keeps a preview <video> near the playhead: free-running while playing, seeking exactly while paused. */
  private previewVideo(layer: VideoLayer, r: RenderInput): HTMLVideoElement | null {
    const asset = r.assets[layer.props.assetId ?? ''];
    let el = this.videos.get(layer.id);
    if (!asset?.video) { if (el) { stopVideo(el); this.videos.delete(layer.id); } return null; }
    if (el?.src !== asset.url) {
      if (el) stopVideo(el);
      el = document.createElement('video');
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.src = asset.url;
      this.videos.set(layer.id, el);
    }
    const dur = asset.video.duration;
    const want = clipTime(layer.props, dur, r.t);
    let drift = Math.abs(el.currentTime - want);
    drift = Math.min(drift, dur - drift); // across the loop point
    if (r.playing) {
      if (el.playbackRate !== layer.props.speed) el.playbackRate = layer.props.speed;
      if (el.paused) el.play().catch(() => {});
      if (drift > 0.3 && !el.seeking) el.currentTime = want;
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.02 && !el.seeking) el.currentTime = want;
    }
    return el.readyState >= 2 ? el : null;
  }

  private st(id: string) {
    let s = this.state.get(id);
    if (!s) this.state.set(id, (s = {}));
    return s;
  }

  private drawLayer(d: DrawCtx, layer: Layer, box: Box, r: RenderInput) {
    switch (layer.type) {
      case 'solid': return drawSolid(d, box, layer.props);
      case 'video': {
        if (r.videoFrames) {
          const f = r.videoFrames.get(layer.id) ?? null;
          return drawVideo(d, box, layer.props, f, f && { w: f.width, h: f.height }, this.st(layer.id));
        }
        const el = this.previewVideo(layer, r);
        return drawVideo(d, box, layer.props, el, el && { w: el.videoWidth, h: el.videoHeight }, this.st(layer.id));
      }
      case 'particles': return drawParticles(d, box, layer.props, this.st(layer.id));
      case 'milkdrop': {
        const k = r.milkScale ?? 1;
        const w = Math.max(2, Math.round(box.w * k)), h = Math.max(2, Math.round(box.h * k));
        let m = this.milk.get(layer.id);
        if (!m) this.milk.set(layer.id, (m = new MilkInstance(w, h)));
        m.resize(w, h);
        if (m.render(layer.props, d.t, d.dt, d.frame)) this.ctx.drawImage(m.canvas, box.x, box.y, box.w, box.h);
        return;
      }
      case 'image': return drawImage(d, box, layer.props, r.assets[layer.props.assetId ?? '']?.image, this.st(layer.id));
      case 'text': return drawText(d, box, layer.props);
      case 'lyrics': return drawLyrics(d, box, layer.props, r.assets[layer.props.assetId ?? '']?.cues);
      case 'socials': return drawSocials(d, box, layer.props);
      case 'waveform': return drawWaveform(d, box, layer.props);
      case 'spectrum': return drawSpectrum(d, box, layer.props, this.st(layer.id));
      case 'vu': return drawVu(d, box, layer.props, this.st(layer.id));
    }
  }

  currentPreset(layerId: string) { return this.milk.get(layerId)?.currentPreset() ?? ''; }

  dispose() {
    for (const m of this.milk.values()) m.dispose();
    this.milk.clear();
    for (const v of this.videos.values()) stopVideo(v);
    this.videos.clear();
  }
}

function stopVideo(v: HTMLVideoElement) {
  v.pause();
  v.removeAttribute('src');
  v.load();
}
