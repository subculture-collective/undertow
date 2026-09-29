export interface LyricWord { t: number; text: string }
export interface LyricCue { start: number; end: number; text: string; words?: LyricWord[] }

const LRC_TIME = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
const WORD_TIME = /<(\d+):(\d+(?:\.\d+)?)>/g;
const toSec = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'));

/** Parses LRC, including enhanced LRC with per-word <mm:ss.xx> stamps. */
export function parseLrc(src: string): LyricCue[] {
  let offset = 0;
  const cues: LyricCue[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const times = [...raw.matchAll(LRC_TIME)];
    if (!times.length) continue;
    const body = raw.replace(LRC_TIME, '').trim();
    let words: LyricWord[] | undefined;
    if (/<\d+:\d+/.test(body)) {
      words = [];
      const parts = body.split(/(<\d+:\d+(?:\.\d+)?>)/);
      let t = -1;
      for (const p of parts) {
        const m = p.match(/^<(\d+):(\d+(?:\.\d+)?)>$/);
        if (m) t = toSec(m[1], m[2]);
        else if (p.trim() && t >= 0) words.push({ t, text: p });
      }
    }
    const text = body.replace(WORD_TIME, '').replace(/\s+/g, ' ').trim();
    for (const m of times) cues.push({ start: toSec(m[1], m[2]), end: 0, text, words });
  }
  return finish(cues, offset);
}

/** Parses SRT or WebVTT subtitles. */
export function parseSubtitles(src: string): LyricCue[] {
  const cues: LyricCue[] = [];
  const stamp = (s: string) => {
    const p = s.trim().replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  for (const block of src.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) cues.push({ start: stamp(a), end: stamp(b.split(' ').filter(Boolean)[0]), text });
  }
  return finish(cues, 0);
}

function finish(cues: LyricCue[], offset: number): LyricCue[] {
  cues.sort((a, b) => a.start - b.start);
  cues.forEach((c, i) => {
    c.start += offset;
    c.words?.forEach((w) => (w.t += offset));
    if (!c.end) c.end = i + 1 < cues.length ? cues[i + 1].start + offset : c.start + 5;
    else c.end += offset;
  });
  // Blank timestamp lines in LRC are instrumental gaps, not lyrics.
  return cues.filter((c) => c.text);
}

export function parseLyrics(name: string, src: string): LyricCue[] {
  return /\.(srt|vtt)$/i.test(name) || src.startsWith('WEBVTT') ? parseSubtitles(src) : parseLrc(src);
}

/** Index of the cue showing at time t, or -1. */
export function cueAt(cues: LyricCue[], t: number): number {
  let lo = 0, hi = cues.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && t < cues[found].end ? found : -1;
}
