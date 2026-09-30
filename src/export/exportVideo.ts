import {
  AudioBufferSource, BufferTarget, Mp4OutputFormat, VideoSample, VideoSampleSource, Output, QUALITY_HIGH, QUALITY_VERY_HIGH,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type AudioCodec,
} from 'mediabunny';
import type { AudioTrack } from '../audio/analysis';
import type { RuntimeAsset } from '../assets';
import { Compositor, type DecodedFrame } from '../render/compositor';
import { clipTime } from '../render/layers';
import { loadPresets } from '../render/milkdrop';
import { ASPECTS, type AspectId, type Project, type VideoLayer } from '../types';
import { ClipReader } from './clipReader';

/** Yields a macrotask so the page stays responsive; encoder promises can resolve without ever doing so. */
const channel = new MessageChannel();
const yieldToBrowser = () => new Promise<void>((resolve) => {
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

/**
 * Turns the canvas into an encoder frame. The fast path copies a GPU frame
 * into CPU memory: handing a GPU canvas frame straight to the encoder measured
 * ~75 ms/frame at 1080p in Chrome on Apple silicon, copying first ~6 ms/frame.
 * Where that copy is unavailable (no pixel format reported, or copyTo fails)
 * it falls back to reading the pixels with getImageData.
 */
function frameCapturer(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  let pixels: Uint8Array | null = null;
  let mode: 'copy' | 'readback' = 'copy';
  const W = canvas.width, H = canvas.height;
  const capture = async (t: number, dur: number): Promise<VideoSample> => {
    const us = Math.round(t * 1e6), dus = Math.round(dur * 1e6);
    if (mode === 'copy') {
      const gpu = new VideoFrame(canvas, { timestamp: us });
      try {
        const format = gpu.format;
        if (!format) throw new Error('canvas VideoFrame has no pixel format');
        const size = gpu.allocationSize();
        if (pixels?.length !== size) pixels = new Uint8Array(size);
        const layout = await gpu.copyTo(pixels);
        const cpu = new VideoFrame(pixels, { format, codedWidth: W, codedHeight: H, timestamp: us, duration: dus, layout });
        return new VideoSample(cpu, { timestamp: t, duration: dur });
      } catch (e) {
        console.warn('VideoFrame copy unavailable, reading canvas pixels instead:', e);
        mode = 'readback';
      } finally {
        gpu.close();
      }
    }
    const img = ctx.getImageData(0, 0, W, H);
    const cpu = new VideoFrame(img.data, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: us, duration: dus });
    return new VideoSample(cpu, { timestamp: t, duration: dur });
  };
  return { capture, mode: () => mode };
}

export interface ExportOptions {
  aspect: AspectId;
  /** Output height for landscape, width for portrait; i.e. the short side. */
  shortSide: 720 | 1080 | 1440 | 2160;
  fps: 24 | 30 | 60;
  start: number;
  end: number;
  quality: 'high' | 'very-high';
  /** Encode the song into the file (default). Cloud renders skip this and mux the original song afterwards. */
  includeAudio?: boolean;
}

export interface ExportProgress { frame: number; frames: number; fps: number; eta: number }

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  videoCodec: string;
  /** Null when the browser has no audio encoder and the video is silent. */
  audioCodec: string | null;
  capture: 'copy' | 'readback';
  msPerFrame: number;
}

export async function exportVideo(
  project: Project, track: AudioTrack | null, assets: Record<string, RuntimeAsset>, o: ExportOptions,
  onProgress: (p: ExportProgress) => void, signal: AbortSignal,
): Promise<ExportResult> {
  const base = ASPECTS[o.aspect];
  const k = o.shortSide / Math.min(base.w, base.h);
  const even = (n: number) => Math.round(n / 2) * 2;
  const W = even(base.w * k), H = even(base.h * k);

  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
  if (!videoCodec) throw new Error(`This browser cannot encode ${W}x${H} video. Try a lower resolution or Chrome.`);

  if (project.layers.some((l) => l.type === 'milkdrop' && l.visible)) await loadPresets();

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const comp = new Compositor(ctx);
  const capturer = frameCapturer(canvas, ctx);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const bitrate = o.quality === 'very-high' ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const video = new VideoSampleSource({ codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: o.fps });

  let audio: AudioBufferSource | null = null;
  let audioCodec: AudioCodec | null = null;
  if (track && o.includeAudio !== false) {
    audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: track.buffer.numberOfChannels, sampleRate: track.sampleRate,
    });
    if (audioCodec) {
      audio = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audio);
    } else console.warn('No encodable audio codec; exporting silent video.');
  }

  // Video layers read exact frames from their clips rather than a playing <video>.
  const clips: { id: string; reader: ClipReader; layer: VideoLayer; duration: number }[] = [];
  const videoFrames = new Map<string, DecodedFrame | null>();
  const closeClips = () => Promise.all(clips.map((c) => c.reader.close()));
  try {
    for (const l of project.layers) {
      const a = l.type === 'video' && l.visible ? assets[l.props.assetId ?? ''] : undefined;
      if (l.type !== 'video' || !a?.video) continue;
      clips.push({ id: l.id, layer: l, duration: a.video.duration, reader: await ClipReader.open(a.blob, a.meta.name, W) });
    }
  } catch (e) {
    await closeClips();
    comp.dispose();
    throw e;
  }

  await output.start();
  let msPerFrame = 0;
  try {
    if (audio && track) {
      await audio.add(track.slice(o.start, o.end));
      audio.close();
    }
    const frames = Math.max(1, Math.round((o.end - o.start) * o.fps));
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = o.start + i / o.fps;
      for (const c of clips) videoFrames.set(c.id, await c.reader.frameAt(clipTime(c.layer.props, c.duration, t)));
      comp.render({ project, aspect: o.aspect, t, dt: 1 / o.fps, track, assets, preview: false, videoFrames });
      const sample = await capturer.capture(i / o.fps, 1 / o.fps);
      try { await video.add(sample); } finally { sample.close(); }
      await yieldToBrowser();
      if (i % 5 === 0 || i === frames - 1) {
        const secs = (performance.now() - t0) / 1000, rate = (i + 1) / secs;
        onProgress({ frame: i + 1, frames, fps: rate, eta: (frames - i - 1) / rate });
      }
    }
    msPerFrame = (performance.now() - t0) / frames;
    video.close();
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  } finally {
    comp.dispose();
    await closeClips();
  }
  return {
    blob: new Blob([output.target.buffer!], { type: 'video/mp4' }),
    width: W, height: H, videoCodec, audioCodec: audio ? audioCodec : null, capture: capturer.mode(), msPerFrame,
  };
}
