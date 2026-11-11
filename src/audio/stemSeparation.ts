import { useEffect } from 'react';
import { create } from 'zustand';
import { tx } from '../idb';
import { useStore } from '../store';
import { AudioTrack } from './analysis';
import { STEM_IDS, STEM_MODEL, stemBlob, stemChannels, stemsKey, storedStemsUsable, type StemId, type StemTracks, type StoredStems } from './stems';
import type { StemWorkerMessage, StemWorkerRequest } from './stems.worker';

/** Cache API bucket for downloaded models. */
export const MODEL_CACHE = 'undertow-models-v1';

/** Stem state per song asset, for the inspector. Stems themselves live on the song's RuntimeAsset. */
export type StemState =
  | { status: 'checking' | 'none' | 'ready' }
  | { status: 'running'; phase: 'load' | 'download' | 'separate' | 'save'; progress: number }
  | { status: 'failed'; message: string };

export const useStemState = create<Record<string, StemState>>(() => ({}));
const setState = (id: string, s: StemState) => useStemState.setState({ [id]: s });

const workers = new Map<string, Worker>();

// wasm-feature-detect's SIMD probe: onnxruntime-web's WebAssembly build needs SIMD.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** Why this browser can't separate stems, or null when it can. */
export function stemSupportProblem(): string | null {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return "This browser can't separate stems: it needs Web Workers and WebAssembly.";
  if (!WebAssembly.validate(SIMD_PROBE)) return "This browser can't separate stems: its WebAssembly has no SIMD support. Recent Chrome, Edge, Firefox and Safari have it.";
  if (!globalThis.crypto?.subtle) return "Stem separation needs a secure (https) connection.";
  return null;
}

/** A warning when the device reports little memory (Chrome and Edge only); separation may still work. */
export function lowMemoryWarning(): string | null {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return gb !== undefined && gb < 4 ? `This device reports ${gb} GB of memory. Separating a whole song may run out of memory; close other tabs first.` : null;
}

export async function isModelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return !!(await (await caches.open(MODEL_CACHE)).match(new URL(STEM_MODEL.url, location.href).href));
  } catch { return false; }
}

/** Builds an AudioTrack per stem from 16-bit PCM channels. */
function toTracks(pcm: Record<StemId, [Int16Array, Int16Array]>, sampleRate: number, length: number): StemTracks {
  const out = {} as StemTracks;
  for (const id of STEM_IDS) {
    const buf = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
    pcm[id].forEach((ch, c) => {
      const f = new Float32Array(length);
      for (let i = 0; i < length; i++) f[i] = ch[i] / 32767;
      buf.copyToChannel(f, c);
    });
    out[id] = new AudioTrack(buf);
  }
  return out;
}

async function storedTracks(s: StoredStems): Promise<StemTracks> {
  const pcm = {} as Record<StemId, [Int16Array, Int16Array]>;
  for (const id of STEM_IDS) pcm[id] = await stemChannels(s.stems[id], s.length);
  return toTracks(pcm, s.sampleRate, s.length);
}

/** Puts stems on the song's runtime asset, where preview and export look for them. */
function attach(assetId: string, stems: StemTracks): boolean {
  const s = useStore.getState(), asset = s.assets[assetId];
  if (!asset) return false;
  s.registerAssets([{ ...asset, stems }]);
  return true;
}

/**
 * Separates a song in a worker: downloads the model (once, then from the
 * Cache API), runs it on WebAssembly and saves the stems in IndexedDB. Nothing
 * is stored until the whole song is done, so cancelling leaves no partial stems.
 */
export function separateStems(assetId: string) {
  const track = useStore.getState().assets[assetId]?.track;
  if (!track || workers.has(assetId)) return;
  const problem = stemSupportProblem();
  if (problem) { setState(assetId, { status: 'failed', message: problem }); return; }

  const b = track.buffer;
  const left = b.getChannelData(0).slice(), right = b.getChannelData(Math.min(1, b.numberOfChannels - 1)).slice();
  const worker = new Worker(new URL('./stems.worker.ts', import.meta.url), { type: 'module' });
  workers.set(assetId, worker);
  setState(assetId, { status: 'running', phase: 'load', progress: 0 });
  const stop = () => { worker.terminate(); if (workers.get(assetId) === worker) workers.delete(assetId); };
  const fail = (message: string) => { stop(); setState(assetId, { status: 'failed', message }); };

  // Messages already queued when the worker was cancelled are ignored.
  const current = () => workers.get(assetId) === worker;
  worker.onmessage = async (e: MessageEvent<StemWorkerMessage>) => {
    if (!current()) return;
    const m = e.data;
    if (m.type === 'progress') { setState(assetId, { status: 'running', phase: m.phase, progress: m.done / m.total }); return; }
    if (m.type === 'error') {
      fail(m.memory ? 'Ran out of memory while separating. Close other tabs and try again, or use a shorter song.' : `Separation failed: ${m.message}`);
      return;
    }
    stop();
    setState(assetId, { status: 'running', phase: 'save', progress: 1 });
    const pcm = Object.fromEntries(STEM_IDS.map((id, i) => [id, [m.stems[i][0], m.stems[i][1]]])) as Record<StemId, [Int16Array, Int16Array]>;
    // The song was removed meanwhile.
    if (!attach(assetId, toTracks(pcm, b.sampleRate, b.length))) { setState(assetId, { status: 'none' }); return; }
    const stored: StoredStems = {
      model: STEM_MODEL.id, sampleRate: b.sampleRate, length: b.length,
      stems: Object.fromEntries(STEM_IDS.map((id) => [id, stemBlob(...pcm[id])])) as StoredStems['stems'],
    };
    try {
      await tx('stems', 'readwrite', (s) => s.put(stored, stemsKey(assetId)));
      setState(assetId, { status: 'ready' });
    } catch (err) {
      // The stems still work until the page is reloaded.
      console.warn('Could not save stems:', err);
      setState(assetId, { status: 'failed', message: `Stems are ready, but this browser could not save them (${(err as Error).message}), so they'll be separated again after a reload.` });
    }
  };
  worker.onerror = (e) => { if (current()) fail(`Separation failed: ${e.message || 'the worker stopped'}`); };
  const req: StemWorkerRequest = {
    model: { url: new URL(STEM_MODEL.url, location.href).href, bytes: STEM_MODEL.bytes, sha256: STEM_MODEL.sha256 },
    cacheName: MODEL_CACHE, left, right,
  };
  worker.postMessage(req, [left.buffer, right.buffer]);
}

/** Stops a running separation. The worker is discarded, so no stems or partial model are kept. */
export function cancelStems(assetId: string) {
  workers.get(assetId)?.terminate();
  workers.delete(assetId);
  setState(assetId, { status: 'none' });
}

/** Loads saved stems for the project's song, once per song and session. */
export function useStemLoader() {
  const audioId = useStore((s) => s.project.audioAssetId);
  const track = useStore((s) => (audioId ? s.assets[audioId]?.track : undefined));
  const loaded = useStore((s) => (audioId ? !!s.assets[audioId]?.stems : false));
  useEffect(() => {
    if (!audioId || !track || loaded || useStemState.getState()[audioId]) return;
    setState(audioId, { status: 'checking' });
    tx<unknown>('stems', 'readonly', (s) => s.get(stemsKey(audioId))).then(async (row) => {
      if (!storedStemsUsable(row, { sampleRate: track.sampleRate, length: track.buffer.length })) return setState(audioId, { status: 'none' });
      const tracks = await storedTracks(row);
      // A separation started meanwhile wins.
      if (useStemState.getState()[audioId]?.status !== 'checking') return;
      setState(audioId, { status: attach(audioId, tracks) ? 'ready' : 'none' });
    }).catch((e) => {
      console.warn('Could not read saved stems:', e);
      setState(audioId, { status: 'none' });
    });
  }, [audioId, track, loaded]);
}
