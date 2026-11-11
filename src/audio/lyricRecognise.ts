import type { HeardWord } from './lyricAlign';

/**
 * Runs a Whisper speech-recognition pipeline (transformers.js, word
 * timestamps) over a whole song in overlapping 30-second windows, the length
 * Whisper reads at once. Each window keeps only the words that start in its
 * middle part, so a word cut by a window edge comes from the next window.
 * Whisper sometimes gets stuck repeating one word over music for a whole
 * window and misses the singing under it; such a window is heard again as two
 * halves, which usually breaks the loop, and a half that is still stuck is
 * dropped.
 * Shared by the alignment worker and the accuracy spike in DEVELOPMENT.md.
 */

export const SAMPLE_RATE = 16000;
const WINDOW = 30, MARGIN = 5;

/** What the pipeline returns for one window with `return_timestamps: 'word'`. */
export interface WordChunks { chunks?: { text: string; timestamp: [number, number | null] }[] }
export type Recognise = (audio: Float32Array) => Promise<WordChunks>;

type Heard = { text: string; start: number; end: number };

/** Whether a window's words look like a repetition loop rather than lyrics. */
export function looksStuck(words: { text: string }[]): boolean {
  const norm = words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (norm.length < 8) return false;
  return new Set(norm).size / norm.length < 0.3;
}

/** Words heard in `audio`, with times from its start. Whisper pads short audio to 30 s and can place words in the padding; those are dropped. */
async function hear(audio: Float32Array, recognise: Recognise): Promise<Heard[]> {
  const out = await recognise(audio), length = audio.length / SAMPLE_RATE;
  return (out.chunks ?? []).filter((c) => c.text.trim() && c.timestamp[0] < length).map((c) => ({
    text: c.text.trim(), start: c.timestamp[0], end: Math.min(length, Math.max(c.timestamp[0], c.timestamp[1] ?? c.timestamp[0] + 0.3)),
  }));
}

/** Window start times, in seconds, for a song of `duration` seconds. */
export function windowStarts(duration: number): number[] {
  const out = [0];
  while (out[out.length - 1] + WINDOW < duration) out.push(out[out.length - 1] + WINDOW - 2 * MARGIN);
  return out;
}

/** The recognised words of a mono 16 kHz song, in time order. `onWindow` reports windows done. */
export async function recogniseSong(samples: Float32Array, recognise: Recognise, onWindow?: (done: number, total: number) => void): Promise<HeardWord[]> {
  const duration = samples.length / SAMPLE_RATE, starts = windowStarts(duration), words: HeardWord[] = [];
  onWindow?.(0, starts.length);
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const audio = samples.subarray(Math.round(s * SAMPLE_RATE), Math.round(Math.min(duration, s + WINDOW) * SAMPLE_RATE));
    let heard = await hear(audio, recognise);
    if (looksStuck(heard)) {
      const half = Math.floor(audio.length / 2);
      const a = await hear(audio.subarray(0, half), recognise), b = await hear(audio.subarray(half), recognise);
      heard = [...(looksStuck(a) ? [] : a), ...(looksStuck(b) ? [] : b.map((w) => ({ ...w, start: w.start + half / SAMPLE_RATE, end: w.end + half / SAMPLE_RATE })))];
    }
    // Words starting in [from, to) belong to this window.
    const from = k === 0 ? 0 : s + MARGIN, to = k === starts.length - 1 ? Infinity : s + WINDOW - MARGIN;
    heard.sort((x, y) => x.start - y.start);
    for (const w of heard) if (s + w.start >= from && s + w.start < to) words.push({ text: w.text, start: s + w.start, end: s + w.end });
    onWindow?.(k + 1, starts.length);
  }
  return words;
}
