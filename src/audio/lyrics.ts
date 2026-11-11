/** `uncertain` marks a word that automatic alignment could not time from the song; LRC does not store it. */
export interface LyricWord { t: number; text: string; uncertain?: boolean }
export interface LyricCue { start: number; end: number; text: string; words?: LyricWord[] }

const LRC_TIME = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
const WORD_TIME = /<(\d+):(\d+(?:\.\d+)?)>/g;
const toSec = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'));

/** Parses LRC, including enhanced LRC with per-word <mm:ss.xx> stamps. */
export function parseLrc(src: string): LyricCue[] {
  let offset = 0;
  const cues: LyricCue[] = [];
  for (const raw of src.split(/\r?\n/)) {
    // LRC convention: a positive offset (milliseconds) makes lyrics appear sooner.
    const off = raw.match(/^\[offset:\s*([+-]?\d+(?:\.\d+)?)\]/i);
    if (off) { offset = -Number(off[1]) / 1000; continue; }
    const times = [...raw.matchAll(LRC_TIME)];
    if (!times.length) continue;
    const body = raw.replace(LRC_TIME, '').trim();
    // Word times are absolute; a word before the first stamp (t = null) starts with the line.
    let words: { t: number | null; text: string }[] | undefined;
    if (/<\d+:\d+/.test(body)) {
      words = [];
      let t: number | null = null;
      for (const p of body.split(/(<\d+:\d+(?:\.\d+)?>)/)) {
        const m = p.match(/^<(\d+):(\d+(?:\.\d+)?)>$/);
        if (m) t = toSec(m[1], m[2]);
        else if (p.trim()) words.push({ t, text: p });
      }
    }
    const text = body.replace(WORD_TIME, '').replace(/\s+/g, ' ').trim();
    const first = toSec(times[0][1], times[0][2]);
    for (const m of times) {
      const start = toSec(m[1], m[2]);
      // A line repeated under several timestamps gets its own copy of the word
      // timings, shifted by how far this repeat is from the first one.
      const shift = start - first;
      cues.push({ start, end: 0, text, words: words?.map((w) => ({ t: w.t === null ? start : w.t + shift, text: w.text })) });
    }
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
  // Cues are separated by blank lines, which may contain stray spaces.
  for (const block of src.replace(/\r/g, '').split(/\n[ \t]*\n/)) {
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
  src = src.replace(/^﻿/, '');
  // A .txt file may hold subtitles: cue arrows without any LRC [mm:ss] tag.
  const subtitles = /\.(srt|vtt)$/i.test(name) || src.startsWith('WEBVTT')
    || (src.includes('-->') && !/^\s*\[\d+:\d+/m.test(src));
  return subtitles ? parseSubtitles(src) : parseLrc(src);
}

/** Index of the cue showing at time t, or -1. */
export function cueAt(cues: LyricCue[], t: number): number {
  let lo = 0, hi = cues.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  // Subtitle cues can overlap: a long cue stays on screen after a shorter later one ends.
  for (let i = found; i >= 0; i--) if (t < cues[i].end) return i;
  return -1;
}

/**
 * An LRC time stamp without brackets: `mm:ss.xx`, or `mm:ss.xxx` when the
 * time has millisecond detail (from SRT or VTT), so nothing is rounded away.
 */
export function lrcTime(t: number): string {
  t = Math.max(0, t);
  const cs = t * 100;
  const centis = Math.abs(cs - Math.round(cs)) < 1e-6;
  const per = centis ? 100 : 1000;
  const units = Math.round(t * per);
  const m = Math.floor(units / (60 * per)), rest = units - m * 60 * per;
  const s = Math.floor(rest / per), frac = rest - s * per;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(centis ? 2 : 3, '0')}`;
}

/**
 * Writes cues as LRC, one `[mm:ss.xx]` line per cue, with enhanced-LRC word
 * stamps where the cue has them. LRC has no end times: a line lasts until the
 * next one starts, so a cue that ends earlier is followed by a blank stamped
 * line, which parseLrc reads as an instrumental gap. A cue that overlaps the
 * next one ends where the next one starts.
 */
export function toLrc(cues: LyricCue[]): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  sorted.forEach((c, i) => {
    const body = c.words?.length ? c.words.map((w) => `<${lrcTime(w.t)}>${w.text}`).join('') : c.text;
    out.push(`[${lrcTime(c.start)}]${body}`);
    const next = sorted[i + 1];
    // Without a following stamp parseLrc gives the last line five seconds.
    const gap = next ? c.end < next.start - 0.0005 : Math.abs(c.end - (c.start + 5)) > 0.0005;
    if (gap) out.push(`[${lrcTime(c.end)}]`);
  });
  return out.join('\n') + '\n';
}
