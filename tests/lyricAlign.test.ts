import { describe, expect, it } from 'vitest';
import { alignLetters, alignLyrics, lyricTokens, normalise, type HeardWord } from '../src/audio/lyricAlign';
import { looksStuck, recogniseSong, SAMPLE_RATE, windowStarts, type WordChunks } from '../src/audio/lyricRecognise';
import { parseLrc, toLrc } from '../src/audio/lyrics';

/** Heard words for `text`, one every `gap` seconds from `t0`. */
const say = (text: string, t0 = 1, gap = 0.5): HeardWord[] =>
  text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, start: t0 + i * gap, end: t0 + i * gap + gap * 0.8 }));

describe('lyric alignment', () => {
  it('keeps the lyric text exactly, whatever the recogniser heard', () => {
    const text = "  Don't  wait — for me, man!\n\n\nÉtude No. 9 (x2)\r\nOoh-ooh, ooh…  ";
    const { cues } = alignLyrics(text, say('dont wait for me man etude number nine ooh ooh ooh'));
    expect(cues.map((c) => c.text)).toEqual(["Don't  wait — for me, man!", 'Étude No. 9 (x2)', 'Ooh-ooh, ooh…']);
    for (const c of cues) expect(c.words!.map((w) => w.text).join('')).toBe(c.text);
  });

  it('takes times from matched words', () => {
    const { cues, matched, words } = alignLyrics('Hello there\nGeneral Kenobi', say('hello there general kenobi', 2, 1));
    expect([matched, words]).toEqual([4, 4]);
    expect(cues.map((c) => [c.start, c.words!.map((w) => w.t)])).toEqual([[2, [2, 3]], [4, [4, 5]]]);
    expect(cues.flatMap((c) => c.words!).some((w) => w.uncertain)).toBe(false);
  });

  it('matches words the recogniser split, joined or punctuated differently', () => {
    const heard: HeardWord[] = [
      { text: ' off', start: 1, end: 1.2 }, { text: 'foot,', start: 1.2, end: 1.5 },
      { text: 'triplecross.', start: 2, end: 2.6 },
    ];
    const { cues } = alignLyrics('off-foot triple-cross', heard);
    expect(cues[0].words!.map((w) => [w.t, !!w.uncertain])).toEqual([[1, false], [2, false]]);
  });

  it('spreads unheard words between their neighbours by length and marks them', () => {
    const heard = [{ text: 'one', start: 10, end: 10.3 }, { text: 'four', start: 14, end: 14.3 }];
    const { cues, matched } = alignLyrics('one two three four', heard);
    expect(matched).toBe(2);
    const w = cues[0].words!;
    expect(w.map((x) => x.t)).toEqual([10, 11.09, 12.18, 14]);
    expect(w.map((x) => !!x.uncertain)).toEqual([false, true, true, false]);
  });

  it('places words before the first and after the last heard word, never below zero', () => {
    const { cues } = alignLyrics('aa bb cc\ndd ee', [{ text: 'cc', start: 0.1, end: 0.4 }, { text: 'dd', start: 3, end: 3.2 }]);
    const times = cues.flatMap((c) => c.words!.map((w) => w.t));
    expect(times[0]).toBe(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[4]).toBeGreaterThan(3);
  });

  it('keeps lines that got no time of their own apart', () => {
    const heard = [{ text: 'one', start: 5, end: 5.2 }, { text: 'four', start: 5, end: 5.2 }];
    const { cues } = alignLyrics('one\ntwo\nthree\nfour', heard);
    expect(cues.map((c) => c.start)).toEqual([5, 5.05, 5.1, 5.15]);
  });

  it('still times every line when nothing was heard', () => {
    const { cues, matched } = alignLyrics('first line\nsecond line', []);
    expect(matched).toBe(0);
    expect(cues).toHaveLength(2);
    expect(cues[1].start).toBeGreaterThan(cues[0].start);
    expect(cues.flatMap((c) => c.words!).every((w) => w.uncertain)).toBe(true);
  });

  it('ends a line early only when the singing stops well before the next one', () => {
    const heard = [...say('a b c', 1, 0.3), ...say('d e f', 2, 0.3), ...say('g h i', 20, 0.3)];
    const { cues } = alignLyrics('a b c\nd e f\ng h i', heard);
    expect(cues[0].end).toBe(cues[1].start);
    expect(cues[1].end).toBeLessThan(5);
  });

  it('writes enhanced LRC that parseLrc reads back with every word stamp', () => {
    const text = "I'm on my off-foot again,\nI pick apart the defense\nWhat isn't ours?";
    const { cues } = alignLyrics(text, say("i'm on my off foot again i pick apart the defense what isn't ours", 61.234, 0.37));
    const lrc = toLrc(cues);
    expect(lrc.split('\n')[0]).toMatch(/^\[01:01\.23\]<01:01\.23>I'm <01:01\.\d\d>on /);
    const back = parseLrc(lrc);
    expect(back.map((c) => c.text)).toEqual(text.split('\n'));
    back.forEach((c, i) => {
      expect(c.start).toBeCloseTo(cues[i].start, 5);
      expect(c.words!.map((w) => w.t)).toEqual(cues[i].words!.map((w) => w.t));
      expect(c.words!.map((w) => w.text)).toEqual(cues[i].words!.map((w) => w.text));
    });
  });
});

describe('alignment helpers', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalise("Don't — Café, NO.9!")).toBe('dontcafeno9');
  });

  it('keeps the spaces after each word', () => {
    const { tokens } = lyricTokens('a  b c');
    expect(tokens.map((t) => t.text)).toEqual(['a  ', 'b ', 'c']);
  });

  it('aligns letters in order and leaves unmatched ones out', () => {
    expect([...alignLetters('abcd', 'axcd')]).toEqual([0, -1, 2, 3]);
    expect([...alignLetters('abc', '')]).toEqual([-1, -1, -1]);
  });

  it('covers a song with overlapping 30-second windows', () => {
    expect(windowStarts(25)).toEqual([0]);
    expect(windowStarts(65)).toEqual([0, 20, 40]);
  });

  it('spots a recogniser stuck repeating one word', () => {
    const w = (s: string) => s.split(' ').map((text) => ({ text }));
    expect(looksStuck(w('Dance Dance Dance Dance, dance Dance Dance Dance Dance tuck'))).toBe(true);
    expect(looksStuck(w("ooh ooh ooh ooh don't wait for me man"))).toBe(false);
  });

  it('hears a stuck window again in halves and keeps words inside each half', async () => {
    const calls: number[] = [];
    const recognise = async (audio: Float32Array): Promise<WordChunks> => {
      calls.push(audio.length / SAMPLE_RATE);
      if (calls.length === 1) return { chunks: Array.from({ length: 20 }, (_, i) => ({ text: 'tuck', timestamp: [i, i + 0.5] as [number, number] })) };
      // Each half: one real word, plus one placed in Whisper's padding past the end of the audio.
      return { chunks: [{ text: `word${calls.length}`, timestamp: [2, 2.4] }, { text: 'ghost', timestamp: [20, 20.5] }] };
    };
    const words = await recogniseSong(new Float32Array(SAMPLE_RATE * 20), recognise);
    expect(calls).toEqual([20, 10, 10]);
    expect(words).toEqual([{ text: 'word2', start: 2, end: 2.4 }, { text: 'word3', start: 12, end: 12.4 }]);
  });
});
