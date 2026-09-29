/**
 * Export self-test, for checking a browser end to end (written for Safari).
 * Open /selftest.html on the dev server; results show on the page and are
 * posted back to the dev server, which saves them under selftest-results/.
 * Nothing is written to the editor's IndexedDB library.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { fontFamily, hydrate, type RuntimeAsset } from './assets';
import { demoTrack } from './audio/demo';
import { createLayer } from './defaults';
import { exportVideo, type ExportOptions, type ExportResult } from './export/exportVideo';
import { Compositor } from './render/compositor';
import { applyTemplate, TEMPLATES } from './templates';
import type { Layer, Project } from './types';

interface Check { name: string; ok: boolean; ms: number; detail: unknown }
const checks: Check[] = [];
const log = document.getElementById('log')!;

async function check(name: string, fn: () => Promise<unknown>) {
  const t0 = performance.now();
  let ok = true, detail: unknown;
  try { detail = await fn(); } catch (e) {
    ok = false;
    const err = e as Error & { detail?: unknown };
    detail = { error: String(err?.message ?? e), detail: err?.detail, stack: err?.stack };
  }
  const c = { name, ok, ms: Math.round(performance.now() - t0), detail };
  checks.push(c);
  const row = document.createElement('pre');
  row.className = ok ? 'ok' : 'fail';
  row.textContent = `${ok ? 'PASS' : 'FAIL'}  ${name}  (${c.ms} ms)\n${JSON.stringify(detail, null, 2)}`;
  log.append(row);
  return c;
}

const track = demoTrack(4);
const project = (layers: Layer[]): Project => ({ version: 1, name: 'selftest', audioAssetId: 'demo-audio', layers });
const audioAsset: RuntimeAsset = { meta: { id: 'demo-audio', kind: 'audio', name: 'demo', mime: '' }, blob: new Blob(), url: '', track };

/** Colourful, deterministic layers (no Milkdrop), so an exported frame can be compared with a direct render. */
function deterministicProject(): Project {
  const solid = createLayer('solid', { color: '#d02030', color2: '#2040d0', angle: 0 });
  const particles = createLayer('particles', { style: 'bokeh', count: 40, color: '#30e060', color2: '#ffe040', size: 1.5 });
  const spectrum = createLayer('spectrum', { color: '#40ffe0', color2: '#ff40c0', glow: 0 });
  const text = createLayer('text', { text: 'Safari export test', color: '#ffffff' });
  const vu = createLayer('vu');
  return project([solid, particles, spectrum, text, vu]);
}

async function readMp4(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const info = {
    bytes: blob.size,
    duration: Number((await input.computeDuration()).toFixed(3)),
    video: v && { codec: v.codec, width: v.displayWidth, height: v.displayHeight, canDecode: await v.canDecode() },
    audio: a && { codec: a.codec, channels: a.numberOfChannels, sampleRate: a.sampleRate },
  };
  return { input, v, info };
}

function stats(img: ImageData) {
  const d = img.data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}
function meanAbsDiff(a: ImageData, b: ImageData) {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) if ((i & 3) !== 3) s += Math.abs(a.data[i] - b.data[i]);
  return s / ((a.data.length / 4) * 3);
}

async function run() {
  const nav = navigator as Navigator & { userAgentData?: unknown };
  await check('environment', async () => ({
    userAgent: nav.userAgent,
    VideoEncoder: typeof VideoEncoder !== 'undefined',
    VideoDecoder: typeof VideoDecoder !== 'undefined',
    AudioEncoder: typeof AudioEncoder !== 'undefined',
    VideoFrame: typeof VideoFrame !== 'undefined',
    canvasLetterSpacing: 'letterSpacing' in CanvasRenderingContext2D.prototype,
    conicGradient: 'createConicGradient' in CanvasRenderingContext2D.prototype,
    roundRect: 'roundRect' in CanvasRenderingContext2D.prototype,
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
  }));

  await check('encodable codecs', async () => {
    const out: Record<string, unknown> = {};
    for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
      out[`video ${w}x${h}`] = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h });
    }
    out.audio = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 44100 });
    return out;
  });

  const opts: ExportOptions = { aspect: 'landscape', shortSide: 720, fps: 30, start: 0, end: 3, quality: 'high' };
  const signal = new AbortController().signal;
  let detBlob: Blob | null = null;

  const det = await check('export: deterministic layers, 720p, 3 s', async () => {
    const res = await exportVideo(deterministicProject(), track, { [audioAsset.meta.id]: audioAsset }, opts, () => {}, signal);
    detBlob = res.blob;
    const { input, v, info } = await readMp4(res.blob);
    if (!v) throw new Error('no video track in output');
    if (!info.audio) throw new Error('no audio track in output');
    if (Math.abs(info.duration - 3) > 0.1) throw new Error(`duration ${info.duration}, expected 3`);

    // Compare frame 45 (t = 1.5 s) of the file with the same frame rendered directly.
    const k = 45;
    const ref = document.createElement('canvas');
    ref.width = res.width; ref.height = res.height;
    const rctx = ref.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const comp = new Compositor(rctx);
    const p = deterministicProject();
    // Same layer ids matter only for per-layer state, which a fresh compositor rebuilds identically.
    for (let i = 0; i <= k; i++) comp.render({ project: p, aspect: 'landscape', t: i / 30, dt: 1 / 30, track, assets: {}, preview: false, videoFrames: new Map() });
    const want = rctx.getImageData(0, 0, ref.width, ref.height);
    const sink = new CanvasSink(v, { width: res.width, height: res.height, fit: 'fill' });
    const got = await sink.getCanvas(k / 30 + 0.001);
    if (!got) throw new Error('could not decode frame 45');
    const cctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    cctx.canvas.width = res.width; cctx.canvas.height = res.height;
    cctx.drawImage(got.canvas, 0, 0);
    const have = cctx.getImageData(0, 0, res.width, res.height);
    input.dispose();
    const diff = meanAbsDiff(want, have);
    const detail = { ...summary(res), file: info, frame45: { rendered: stats(want), decoded: stats(have), meanAbsDiff: Number(diff.toFixed(2)) } };
    // H.264 at this bitrate differs by a few levels; a colour-channel swap or blank frame differs by tens.
    if (diff > 8) throw Object.assign(new Error(`decoded frame differs from render (mean abs diff ${diff.toFixed(1)})`), { detail });
    return detail;
  });

  await check('export: all templates incl. Milkdrop, 720p, 2 s each', async () => {
    const out: Record<string, unknown> = {};
    for (const t of TEMPLATES) {
      const p = applyTemplate(t, project([]), {});
      p.audioAssetId = audioAsset.meta.id;
      const res = await exportVideo(p, track, { [audioAsset.meta.id]: audioAsset }, { ...opts, end: 2 }, () => {}, signal);
      const { input, info } = await readMp4(res.blob);
      input.dispose();
      out[t.id] = { msPerFrame: Math.round(res.msPerFrame), duration: info.duration, audio: info.audio?.codec ?? null };
    }
    return out;
  });

  await check('export: looping video background decoded from an MP4', async () => {
    if (!det.ok || !detBlob) throw new Error('needs the deterministic export to have passed');
    const clip = await hydrate({ id: 'selftest-clip', kind: 'video', name: 'selftest.mp4', mime: 'video/mp4' }, detBlob);
    const layer = createLayer('video', { assetId: clip.meta.id, speed: 1.5, offset: 2 });
    const res = await exportVideo(project([layer]), track, { [clip.meta.id]: clip, [audioAsset.meta.id]: audioAsset }, { ...opts, end: 2 }, () => {}, signal);
    const { input, v, info } = await readMp4(res.blob);
    // t = 1 s lands at clip time (2 + 1.5) mod 3 = 0.5 s, i.e. after the loop point.
    const sink = new CanvasSink(v!, { width: 320 });
    const f = await sink.getCanvas(1);
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    c.canvas.width = f!.canvas.width; c.canvas.height = f!.canvas.height;
    c.drawImage(f!.canvas, 0, 0);
    const s = stats(c.getImageData(0, 0, c.canvas.width, c.canvas.height));
    input.dispose();
    if (s.r + s.g + s.b < 30) throw new Error(`frame after loop point is black: ${JSON.stringify(s)}`);
    return { ...summary(res), file: info, clipDuration: clip.video?.duration, frameAt1s: s };
  });

  await check('custom font upload (FontFace from file bytes)', async () => {
    const resp = await fetch('/__selftest/font');
    if (!resp.ok) throw new Error('dev server has no test font to serve');
    const blob = await resp.blob();
    const asset = await hydrate({ id: 'selftest-font', kind: 'font', name: 'test.ttf', mime: 'font/ttf' }, blob);
    const c = document.createElement('canvas').getContext('2d')!;
    const text = 'Handgloves 0123';
    c.font = '700 40px system-ui';
    const fallback = c.measureText(text).width;
    c.font = `700 40px "${fontFamily(asset.meta.id)}", system-ui`;
    const custom = c.measureText(text).width;
    document.fonts.delete(asset.font!);
    if (Math.abs(custom - fallback) < 1) throw new Error(`uploaded font not used (width ${custom} vs fallback ${fallback})`);
    return { status: asset.font!.status, widthFallback: Math.round(fallback), widthCustom: Math.round(custom) };
  });

  const passed = checks.filter((c) => c.ok).length;
  document.getElementById('status')!.textContent = `${passed}/${checks.length} checks passed`;
  await fetch('/__selftest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at: new Date().toISOString(), checks }) })
    .catch(() => {});
}

function summary(r: ExportResult) {
  return { size: `${r.width}x${r.height}`, videoCodec: r.videoCodec, audioCodec: r.audioCodec, capture: r.capture, msPerFrame: Number(r.msPerFrame.toFixed(1)) };
}

void run();
