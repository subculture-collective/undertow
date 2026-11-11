/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { BINS, SOURCES, unmix } from './unmix';

/** Messages from the worker; see separateStems in stemSeparation.ts. */
export type StemWorkerMessage =
  | { type: 'progress'; phase: 'load' | 'download' | 'separate'; done: number; total: number }
  | { type: 'done'; stems: Int16Array[][] }
  | { type: 'error'; message: string; memory: boolean };

export interface StemWorkerRequest {
  model: { url: string; bytes: number; sha256: string };
  cacheName: string;
  left: Float32Array;
  right: Float32Array;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: StemWorkerMessage, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

async function sha256(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The model from the Cache API, or downloaded and cached once its checksum matches. */
async function loadModel(m: StemWorkerRequest['model'], cacheName: string): Promise<Uint8Array> {
  const cache = 'caches' in scope ? await caches.open(cacheName).catch(() => null) : null;
  const hit = await cache?.match(m.url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (await sha256(bytes) === m.sha256) return bytes;
    await cache!.delete(m.url);
  }
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`The stem model could not be downloaded (HTTP ${res.status}).`);
  const bytes = new Uint8Array(m.bytes);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > bytes.length) throw new Error('The stem model download is larger than expected.');
    bytes.set(value, got);
    got += value.length;
    post({ type: 'progress', phase: 'download', done: got, total: m.bytes });
  }
  if (got !== m.bytes || await sha256(bytes) !== m.sha256) throw new Error('The stem model download was incomplete or is not the expected file.');
  await cache?.put(m.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return bytes;
}

scope.onmessage = async (e: MessageEvent<StemWorkerRequest>) => {
  try {
    const { model, cacheName, left, right } = e.data;
    post({ type: 'progress', phase: 'load', done: 0, total: 1 });
    const bytes = await loadModel(model, cacheName);
    post({ type: 'progress', phase: 'load', done: 0, total: 1 });
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    // The site isn't cross-origin isolated, so WebAssembly threads aren't available.
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const stems = await unmix(left, right, async (mag, frames) => {
      const out = await session.run({ mag: new ort.Tensor('float32', mag, [1, 2, BINS, frames]) });
      const est = out.est as ort.Tensor;
      const data = (est.data as Float32Array).slice(0, SOURCES * 2 * BINS * frames);
      est.dispose();
      return data;
    }, { onProgress: (done, total) => post({ type: 'progress', phase: 'separate', done, total }) });
    await session.release();
    post({ type: 'done', stems }, stems.flat().map((s) => s.buffer));
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    post({ type: 'error', message, memory: err instanceof RangeError || /memory|alloc|bad_alloc/i.test(message) });
  }
};
