import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { alignLyrics } from './lyricAlign';
import { recogniseSong } from './lyricRecognise';
import type { AlignRequest, AlignMessage } from './lyricAlignClient';

/**
 * Speech recognition for automatic lyric alignment. Loads transformers.js and
 * a Whisper model with word timestamps, runs it over the song, aligns the
 * heard words to the lyric text and posts the timed lines back. The audio
 * stays in this worker; only the model files are downloaded, from Hugging
 * Face, and the browser caches them.
 */

const scope = self as unknown as { onmessage: ((e: MessageEvent<AlignRequest>) => void) | null; postMessage: (m: AlignMessage) => void };
const post = (m: AlignMessage) => scope.postMessage(m);

/**
 * Whether a hardware GPU is available through WebGPU. A fallback adapter is a
 * software renderer (SwiftShader in Chromium): on it a 40-second clip took
 * about 8 minutes, against 20 seconds on the WebAssembly CPU path.
 */
async function webgpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
  try {
    const adapter = await gpu?.requestAdapter();
    return !!adapter && !adapter.info?.isFallbackAdapter;
  } catch { return false; }
}

scope.onmessage = async (e) => {
  const { model, samples, text } = e.data;
  try {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    // The ONNX runtime comes from this site rather than a CDN.
    env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasm };

    const loaded = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      loaded.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let a = 0, b = 0;
      for (const v of loaded.values()) { a += v.loaded; b += v.total; }
      post({ type: 'download', loaded: a, total: b });
    };
    const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q8' } as const;
    const id = `onnx-community/whisper-${model}_timestamped`;
    let device: 'webgpu' | 'wasm' = (await webgpu()) ? 'webgpu' : 'wasm';
    let pipe;
    try {
      pipe = await pipeline('automatic-speech-recognition', id, { dtype, device, progress_callback });
    } catch (err) {
      if (device !== 'webgpu') throw err;
      // A GPU that fails to set up the model: the files are cached by now, so the CPU path loads quickly.
      console.warn('WebGPU unavailable for alignment, using WebAssembly:', err);
      device = 'wasm';
      pipe = await pipeline('automatic-speech-recognition', id, { dtype, device, progress_callback });
    }
    post({ type: 'ready', device });
    const words = await recogniseSong(samples, (audio) => pipe(audio, { return_timestamps: 'word' }) as never,
      (done, total) => post({ type: 'recognise', done, total }));
    post({ type: 'done', result: alignLyrics(text, words) });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
