import type { AlignResult } from './lyricAlign';
import { SAMPLE_RATE } from './lyricRecognise';

/**
 * Main-thread side of automatic lyric alignment: resamples the song and runs
 * recognition and alignment in src/audio/lyricAlign.worker.ts. Measured accuracy per model is in DEVELOPMENT.md.
 */

export type AlignModel = 'tiny' | 'base' | 'small';

/** Download sizes: the fp32 encoder plus the 8-bit decoder, from the Hugging Face file listing. */
export const ALIGN_MODELS: { id: AlignModel; label: string; mb: number }[] = [
  { id: 'tiny', label: 'Fast', mb: 64 },
  { id: 'base', label: 'Balanced', mb: 136 },
  { id: 'small', label: 'Accurate', mb: 510 },
];
export const DEFAULT_ALIGN_MODEL: AlignModel = 'base';

export interface AlignRequest { model: AlignModel; samples: Float32Array; text: string }
export type AlignMessage =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'recognise'; done: number; total: number }
  | { type: 'done'; result: AlignResult }
  | { type: 'error'; message: string };

export type AlignProgress =
  | { stage: 'prepare' }
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'recognise'; done: number; total: number; device: 'webgpu' | 'wasm' };

/** Why this browser can't align, or null. */
export function alignUnsupported(): string | null {
  if (typeof WebAssembly !== 'object' || typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    return 'This browser can’t run the speech model. Try a current Chrome, Edge, Firefox or Safari.';
  }
  return null;
}

const modelUrl = (m: AlignModel) => `https://huggingface.co/onnx-community/whisper-${m}_timestamped/resolve/main/onnx/encoder_model.onnx`;

/** Whether the model's files are already in the browser cache (checked by its largest file). */
export async function isModelCached(m: AlignModel): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    return !!(await cache.match(modelUrl(m)));
  } catch { return false; }
}

/** The song as mono 16 kHz samples, what Whisper reads. */
export async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  // A copy, so it can be handed to the worker.
  return (await ctx.startRendering()).getChannelData(0).slice();
}

/** Recognises the song and times `text` from it. Rejects with an AbortError when `signal` aborts. */
export async function alignToSong(buffer: AudioBuffer, text: string, model: AlignModel, onProgress: (p: AlignProgress) => void, signal: AbortSignal): Promise<AlignResult> {
  onProgress({ stage: 'prepare' });
  const samples = await toMono16k(buffer);
  if (signal.aborted) throw new DOMException('Aligning was cancelled', 'AbortError');
  return new Promise<AlignResult>((resolve, reject) => {
    const worker = new Worker(new URL('./lyricAlign.worker.ts', import.meta.url), { type: 'module' });
    let device: 'webgpu' | 'wasm' = 'wasm';
    const stop = () => { worker.terminate(); reject(new DOMException('Aligning was cancelled', 'AbortError')); };
    signal.addEventListener('abort', stop, { once: true });
    const end = () => { signal.removeEventListener('abort', stop); worker.terminate(); };
    worker.onmessage = (e: MessageEvent<AlignMessage>) => {
      const m = e.data;
      if (m.type === 'download') onProgress({ stage: 'download', loaded: m.loaded, total: m.total });
      else if (m.type === 'ready') device = m.device;
      else if (m.type === 'recognise') onProgress({ stage: 'recognise', done: m.done, total: m.total, device });
      else if (m.type === 'done') { end(); resolve(m.result); }
      else { end(); reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { end(); reject(new Error(e.message || 'The speech model stopped unexpectedly.')); };
    worker.postMessage({ model, samples, text } satisfies AlignRequest, [samples.buffer]);
  });
}

/** A failure message for people, from an error thrown by alignToSong. */
export function alignErrorMessage(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  if (/fetch|network|load failed|could not locate|404|ERR_/i.test(msg)) return `Couldn’t download the speech model. Check your connection and try again. (${msg})`;
  if (/memory|allocation|RangeError/i.test(msg)) return `The browser ran out of memory. Close other tabs or pick a smaller model. (${msg})`;
  return `Aligning failed: ${msg}`;
}
