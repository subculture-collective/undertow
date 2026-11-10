import { detectTempo } from './tempo';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };

scope.onmessage = (e: MessageEvent<{ mono: Float32Array; sampleRate: number }>) => {
  try {
    scope.postMessage({ ok: true, result: detectTempo([e.data.mono], e.data.sampleRate) });
  } catch (err) {
    scope.postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
