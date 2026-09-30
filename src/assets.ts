import { decodeAudio, type AudioTrack } from './audio/analysis';
import { parseLyrics, type LyricCue } from './audio/lyrics';
import { uid } from './defaults';
import { tx } from './idb';
import type { AssetKind, AssetMeta } from './types';

export interface RuntimeAsset {
  meta: AssetMeta;
  blob: Blob;
  url: string;
  image?: HTMLImageElement;
  track?: AudioTrack;
  cues?: LyricCue[];
  video?: { duration: number; width: number; height: number };
  font?: FontFace;
}

/** The CSS family an uploaded font is registered under; unique per asset so two uploads never clash. */
export const fontFamily = (assetId: string) => `vz-${assetId}`;
/** A readable name for an uploaded font, from its file name. */
export const fontLabel = (a: RuntimeAsset) => a.meta.name.replace(/\.(ttf|otf|woff2?)$/i, '');

// ---- loading --------------------------------------------------------------
export function kindOf(file: { name: string; type: string }): AssetKind | null {
  if (file.type.startsWith('image/') || /\.(svg|png|jpe?g|webp|gif|avif)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i.test(file.name)) return 'audio';
  if (file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(file.name)) return 'font';
  if (/\.(lrc|srt|vtt|txt)$/i.test(file.name)) return 'lyrics';
  return null;
}

/** SVGs without width/height have no intrinsic size and draw at 0x0 in some browsers. */
async function normaliseSvg(blob: Blob): Promise<Blob> {
  const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg') return blob;
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && (!svg.getAttribute('width') || !svg.getAttribute('height') || svg.getAttribute('width')!.includes('%'))) {
    const k = 2048 / Math.max(vb[2], vb[3]);
    svg.setAttribute('width', String(Math.round(vb[2] * k)));
    svg.setAttribute('height', String(Math.round(vb[3] * k)));
  }
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}

export async function hydrate(meta: AssetMeta, blob: Blob): Promise<RuntimeAsset> {
  const url = URL.createObjectURL(blob);
  const a: RuntimeAsset = { meta, blob, url };
  if (meta.kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    a.image = img;
  } else if (meta.kind === 'audio') {
    a.track = await decodeAudio(await blob.arrayBuffer());
  } else if (meta.kind === 'video') {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error(`This browser cannot play ${meta.name}. Try an H.264 MP4 or WebM.`));
      v.src = url;
    });
    a.video = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
    v.removeAttribute('src');
  } else if (meta.kind === 'font') {
    // A weight range stops the browser from faking bold on single-weight files; variable fonts use their real axis.
    const face = new FontFace(fontFamily(meta.id), await blob.arrayBuffer(), { weight: '1 1000' });
    await face.load();
    document.fonts.add(face);
    a.font = face;
  } else {
    a.cues = parseLyrics(meta.name, await blob.text());
  }
  return a;
}

export async function importFile(file: File): Promise<RuntimeAsset> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
  let blob: Blob = file;
  if (kind === 'image' && (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name))) blob = await normaliseSvg(file);
  const meta: AssetMeta = { id: uid(), kind, name: file.name, mime: blob.type || file.type };
  const asset = await hydrate(meta, blob);
  await tx('assets', 'readwrite', (s) => s.put({ meta, blob }, meta.id));
  return asset;
}

const LOAD_TIMEOUT_MS = 20_000;

/**
 * Loads the saved library. Files load in parallel, each with a time limit, so
 * one that never finishes decoding (a corrupt clip, or an image in a hidden
 * tab) can't hold back the rest; it is skipped with a warning.
 */
export async function loadStoredAssets(): Promise<RuntimeAsset[]> {
  const rows = await tx<{ meta: AssetMeta; blob: Blob }[]>('assets', 'readonly', (s) => s.getAll());
  const results = await Promise.allSettled(rows.map((r) => Promise.race([
    hydrate(r.meta, r.blob),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), LOAD_TIMEOUT_MS)),
  ])));
  return results.flatMap((res, i) => {
    if (res.status === 'fulfilled') return [res.value];
    console.warn('could not load asset', rows[i].meta.name, res.reason);
    return [];
  });
}

export async function deleteStoredAsset(id: string) {
  await tx('assets', 'readwrite', (s) => s.delete(id));
}
