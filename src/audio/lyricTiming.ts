import type { LyricCue, LyricWord } from './lyrics';

/**
 * Editing rules for the lyric timing editor (src/ui/LyricTimingEditor.tsx).
 *
 * Word stamps: moving a line (dragging its region, nudging it, or stamping it
 * in tap mode) moves its enhanced-LRC word stamps by the same amount.
 * Dragging only an edge leaves the word stamps where they are.
 */

/** A line in the editor. Pasted lines have no times until they are stamped. */
export interface TimedLine { text: string; start: number | null; end: number | null; words?: LyricWord[] }

/** The shortest a line can be made by dragging an edge, in seconds. */
export const MIN_LINE = 0.05;
/** Edits land on 10 ms steps, the resolution of an LRC `[mm:ss.xx]` stamp. */
const step = (t: number) => Math.round(t * 100) / 100;
/** Drops floating-point noise from sums without rounding away millisecond times from SRT or VTT. */
const tidy = (t: number) => Math.round(t * 1e6) / 1e6;

export const linesFromCues = (cues: LyricCue[]): TimedLine[] =>
  cues.map((c) => ({ text: c.text, start: c.start, end: c.end, words: c.words?.map((w) => ({ ...w })) }));

/** One line per non-empty line of text, untimed. */
export const linesFromText = (text: string): TimedLine[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((text) => ({ text, start: null, end: null }));

/**
 * The stamped lines in time order, by index into `lines`, with the time each
 * one shows until. A line without an end lasts until the next stamped line, or
 * five seconds. LRC has no end times, so a line can end before the next one
 * starts (saved as a blank stamped line) but never after it.
 */
export function spans(lines: TimedLine[]): { i: number; start: number; end: number }[] {
  const order = lines.flatMap((l, i) => (l.start === null ? [] : [i])).sort((a, b) => lines[a].start! - lines[b].start!);
  return order.map((i, k) => {
    const l = lines[i], next = k + 1 < order.length ? lines[order[k + 1]].start! : undefined;
    return { i, start: l.start!, end: Math.min(l.end ?? next ?? l.start! + 5, next ?? Infinity) };
  });
}

/** Cues for the stamped lines: what the stage previews and what is saved. */
export function toCues(lines: TimedLine[]): LyricCue[] {
  return spans(lines).map(({ i, start, end }) => {
    const l = lines[i], cue: LyricCue = { start, end, text: l.text };
    if (l.words) cue.words = l.words.map((w) => ({ ...w }));
    return cue;
  });
}

/** Moves a line to begin at `start`, keeping its length. Word stamps move with it. */
export function moveLine(l: TimedLine, start: number): TimedLine {
  start = Math.max(0, step(start));
  if (l.start === null) return { ...l, start };
  const d = start - l.start;
  return { ...l, start, end: l.end === null ? null : tidy(l.end + d), words: l.words?.map((w) => ({ t: tidy(w.t + d), text: w.text })) };
}

/** Drags the start edge; the line keeps at least MIN_LINE. */
export function setStart(l: TimedLine, start: number): TimedLine {
  const max = l.end === null ? Infinity : l.end - MIN_LINE;
  return { ...l, start: Math.max(0, Math.min(max, step(start))) };
}

/** Drags the end edge; the line keeps at least MIN_LINE. */
export function setEnd(l: TimedLine, end: number): TimedLine {
  return { ...l, end: Math.max((l.start ?? 0) + MIN_LINE, step(end)) };
}

/** Tap mode: line `i` starts at `t`, and the stamped line before it ends there. */
export function stampLine(lines: TimedLine[], i: number, t: number): TimedLine[] {
  const out = lines.slice();
  out[i] = moveLine(lines[i], t);
  const prev = lines[i - 1];
  const at = out[i].start!;
  if (prev && prev.start !== null && at > prev.start + MIN_LINE) out[i - 1] = { ...prev, end: at };
  return out;
}
