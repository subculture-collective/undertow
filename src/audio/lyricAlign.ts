import type { LyricCue, LyricWord } from './lyrics';

/**
 * Automatic lyric alignment: puts times on the user's lyric text using the
 * words a speech recogniser heard (src/audio/lyricAlign.worker.ts). The text
 * always comes from the user; recognition only supplies times.
 *
 * Recognised and lyric words are compared letter by letter (case, accents and
 * punctuation ignored) with a global sequence alignment, so a word the
 * recogniser split or joined still lines up. A lyric word whose letters mostly
 * match takes its time from the recognised word they came from. The other
 * words are spread between the matched words around them by letter count and
 * marked `uncertain`.
 */

/** A word as the recogniser heard it, with song times in seconds. */
export interface HeardWord { text: string; start: number; end: number }

export interface AlignResult {
  cues: LyricCue[];
  /** Lyric words that took a time from a recognised word. */
  matched: number;
  /** All lyric words. */
  words: number;
}

/** A word needs this share of its letters matched exactly to take a time from recognition. */
const ANCHOR = 0.5;
/** Below this share of matched letters the word is marked uncertain. */
const SURE = 0.8;
/** Seconds per letter for words before the first or after the last matched word. */
const PER_CHAR = 0.07;

/** Lower case, without accents or anything but letters and digits. */
export const normalise = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

interface Token { line: number; text: string; norm: string }

/**
 * The lyric text as lines of words. Each word keeps the spaces after it, so the
 * words of a line join back to the line exactly. Lines are trimmed and empty
 * lines skipped, as in the timing editor.
 */
export function lyricTokens(text: string): { lines: string[]; tokens: Token[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tokens = lines.flatMap((l, line) => (l.match(/\S+\s*/g) ?? []).map((t) => ({ line, text: t, norm: normalise(t) })));
  return { lines, tokens };
}

/**
 * Global alignment of two letter sequences with affine gaps (match +4,
 * mismatch -2, gap -4 to open and -1 per letter after), so skipped stretches
 * stay in one piece instead of breaking up the words around them. A gap
 * costs 2 more when it starts inside a word (where `aStart`/`bStart` mark the
 * first letters of words), so gaps fall between words. Returns, for each
 * letter of `a`, the index of the equal letter of `b` it lines up with, or -1.
 */
export function alignLetters(a: string, b: string, aStart?: Uint8Array, bStart?: Uint8Array): Int32Array {
  const n = a.length, m = b.length, w = m + 1;
  const out = new Int32Array(n).fill(-1);
  if (!n || !m) return out;
  // One byte per cell; about 20 minutes of dense rap against its transcript.
  if ((n + 1) * w > 4e8) throw new Error('These lyrics are too long to align in one go. Split the song into parts.');
  const MATCH = 4, MISS = -2, OPEN = -4, EXT = -1, NEG = -1e9;
  // Per cell, bits 0-1: which state the diagonal state M came from (0 M, 1 X, 2 Y);
  // bit 2: X (letter of a against a gap) extends X; bit 3: Y (letter of b against a gap) extends Y.
  const dir = new Uint8Array((n + 1) * w);
  let pM = new Int32Array(w), pX = new Int32Array(w), pY = new Int32Array(w);
  let cM = new Int32Array(w), cX = new Int32Array(w), cY = new Int32Array(w);
  pM[0] = 0; pX[0] = NEG; pY[0] = NEG;
  const openA = (i: number) => (!aStart || aStart[i] ? OPEN : OPEN - 2), openB = (j: number) => (!bStart || bStart[j] ? OPEN : OPEN - 2);
  for (let j = 1; j <= m; j++) { pM[j] = NEG; pX[j] = NEG; pY[j] = OPEN + (j - 1) * EXT; dir[j] = 8; }
  for (let i = 1; i <= n; i++) {
    cM[0] = NEG; cY[0] = NEG; cX[0] = OPEN + (i - 1) * EXT; dir[i * w] = 4;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      let d = 0;
      let best = pM[j - 1], from = 0;
      if (pX[j - 1] > best) { best = pX[j - 1]; from = 1; }
      if (pY[j - 1] > best) { best = pY[j - 1]; from = 2; }
      cM[j] = best + (ai === b.charCodeAt(j - 1) ? MATCH : MISS);
      d |= from;
      const xo = pM[j] + openA(i - 1), xe = pX[j] + EXT;
      if (xe > xo) { cX[j] = xe; d |= 4; } else cX[j] = xo;
      const yo = cM[j - 1] + openB(j - 1), ye = cY[j - 1] + EXT;
      if (ye > yo) { cY[j] = ye; d |= 8; } else cY[j] = yo;
      dir[i * w + j] = d;
    }
    [pM, cM] = [cM, pM]; [pX, cX] = [cX, pX]; [pY, cY] = [cY, pY];
  }
  let state = pM[m] >= pX[m] && pM[m] >= pY[m] ? 0 : pX[m] >= pY[m] ? 1 : 2;
  for (let i = n, j = m; i > 0 && j > 0;) {
    const d = dir[i * w + j];
    if (state === 0) {
      if (a[i - 1] === b[j - 1]) out[i - 1] = j - 1;
      state = d & 3; i--; j--;
    } else if (state === 1) { state = d & 4 ? 1 : 0; i--; }
    else { state = d & 8 ? 2 : 0; j--; }
  }
  return out;
}

const round = (t: number) => Math.round(Math.max(0, t) * 100) / 100;

/** Times the lyric text from recognised words. Lines without words are skipped. */
export function alignLyrics(text: string, heard: HeardWord[]): AlignResult {
  const { lines, tokens } = lyricTokens(text);
  const rec = heard.map((h) => ({ ...h, norm: normalise(h.text) })).filter((h) => h.norm);
  const a = tokens.map((t) => t.norm).join(''), b = rec.map((r) => r.norm).join('');
  // Which recognised word, and which letter of it, each letter of b is.
  const recOf = new Int32Array(b.length), posOf = new Int32Array(b.length);
  for (let k = 0, j = 0; k < rec.length; k++) for (let p = 0; p < rec[k].norm.length; p++, j++) { recOf[j] = k; posOf[j] = p; }
  const starts = (words: string[]) => {
    const out = new Uint8Array(words.reduce((n, w) => n + w.length, 0));
    for (let k = 0, at = 0; k < words.length; at += words[k].length, k++) out[at] = 1;
    return out;
  };
  const map = alignLetters(a, b, starts(tokens.map((t) => t.norm)), starts(rec.map((r) => r.norm)));

  // A time for each lyric word from its first matched letter, or null.
  const times: (number | null)[] = [], sure: boolean[] = [];
  let at = 0, matched = 0;
  for (const tok of tokens) {
    const len = tok.norm.length;
    let hits = 0, t: number | null = null;
    for (let p = 0; p < len; p++) {
      const j = map[at + p];
      if (j < 0) continue;
      hits++;
      if (t === null) {
        const r = rec[recOf[j]], per = (r.end - r.start) / r.norm.length;
        // Back up over this word's letters before the matched one.
        t = r.start + (posOf[j] - p) * per;
      }
    }
    at += len;
    const share = len ? hits / len : 0;
    if (share >= ANCHOR && t !== null) { times.push(t); matched++; } else times.push(null);
    sure.push(share >= SURE);
  }

  // Words without a time sit between their neighbours, spaced by letter count.
  const size = tokens.map((t) => Math.max(1, t.norm.length));
  const anchors = times.flatMap((t, i) => (t === null ? [] : [i]));
  const filled = times.slice();
  if (!anchors.length) {
    let t = 0;
    tokens.forEach((_, i) => { filled[i] = t; t += size[i] * PER_CHAR; });
  } else {
    const first = anchors[0], last = anchors[anchors.length - 1];
    for (let i = first - 1; i >= 0; i--) filled[i] = filled[i + 1]! - size[i] * PER_CHAR;
    for (let i = last + 1; i < tokens.length; i++) filled[i] = filled[i - 1]! + size[i - 1] * PER_CHAR;
    for (let k = 0; k + 1 < anchors.length; k++) {
      const i0 = anchors[k], i1 = anchors[k + 1], t0 = times[i0]!, t1 = Math.max(t0, times[i1]!);
      let total = 0;
      for (let i = i0; i < i1; i++) total += size[i];
      let run = size[i0];
      for (let i = i0 + 1; i < i1; i++) { filled[i] = t0 + ((t1 - t0) * run) / total; run += size[i]; }
    }
  }
  // Times never go backwards, and a line starts at least 50 ms after the one before.
  for (let i = 0, max = 0, lineStart = -1; i < filled.length; i++) {
    const newLine = i > 0 && tokens[i].line !== tokens[i - 1].line;
    max = Math.max(max, round(filled[i]!), newLine ? round(lineStart + 0.05) : 0);
    if (i === 0 || newLine) lineStart = max;
    filled[i] = max;
  }

  const cues: LyricCue[] = [];
  let k = 0;
  lines.forEach((line, li) => {
    const words: LyricWord[] = [];
    for (; k < tokens.length && tokens[k].line === li; k++) {
      words.push(sure[k] ? { t: filled[k]!, text: tokens[k].text } : { t: filled[k]!, text: tokens[k].text, uncertain: true });
    }
    if (words.length) cues.push({ start: words[0].t, end: 0, text: line, words });
  });
  // A line lasts until the next one, unless the singing clearly stops well before it.
  cues.forEach((c, i) => {
    const next = cues[i + 1]?.start, w = c.words!, lastWord = w[w.length - 1];
    const sung = round(lastWord.t + Math.max(0.4, normalise(lastWord.text).length * PER_CHAR * 2));
    c.end = next === undefined ? Math.max(sung, c.start + 1) : sung < next - 1 ? sung : next;
  });
  return { cues, matched, words: tokens.length };
}
