import { expect, it } from 'vitest';
import { cueAt, lrcTime, parseLrc, parseLyrics, parseSubtitles, toLrc } from '../src/audio/lyrics';

it('gives each repeat of an enhanced LRC line its own word timings', () => {
  const cues = parseLrc('[offset:-500]\n[00:10.00][00:30.00]<00:10.00>Hey <00:11.00>you');
  expect(cues.map((c) => c.start)).toEqual([10.5, 30.5]);
  expect(cues[0].words?.map((w) => w.t)).toEqual([10.5, 11.5]);
  expect(cues[1].words?.map((w) => w.t)).toEqual([30.5, 31.5]);
});

it('follows the LRC offset convention: positive shows lyrics sooner', () => {
  expect(parseLrc('[offset:+500]\n[00:10.00]a')[0].start).toBe(9.5);
  expect(parseLrc('[offset:-250]\n[00:10.00]a')[0].start).toBe(10.25);
});

it('keeps text before the first word stamp in the word list', () => {
  const [cue] = parseLrc('[00:01.00]Intro <00:02.00>word');
  expect(cue.words).toEqual([{ t: 1, text: 'Intro ' }, { t: 2, text: 'word' }]);
});

it('splits SRT cues on blank lines that contain spaces', () => {
  const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nhi\n \n2\n00:00:03,000 --> 00:00:04,000\nyo');
  expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([[1, 2, 'hi'], [3, 4, 'yo']]);
});

it('reads subtitles saved as .txt, with or without a byte-order mark', () => {
  expect(parseLyrics('song.txt', '﻿WEBVTT\n\n00:01.000 --> 00:02.000\nhi')).toHaveLength(1);
  expect(parseLyrics('song.txt', '1\n00:00:01,000 --> 00:00:02,000\nhi')).toHaveLength(1);
  expect(parseLyrics('song.txt', '[00:01.00]hi')).toHaveLength(1);
});

it('keeps a long subtitle cue on screen after a shorter overlapping one ends', () => {
  const cues = parseSubtitles('00:00.000 --> 00:10.000\nA\n\n00:02.000 --> 00:03.000\nB');
  expect(cueAt(cues, 2.5)).toBe(1);
  expect(cues[cueAt(cues, 5)].text).toBe('A');
  expect(cueAt(cues, 11)).toBe(-1);
});

const LRC = `[ti:Song]
[00:01.00]First line
[00:04.50]<00:04.50>Second <00:05.25>line <00:06.00>here
[00:08.00]
[00:10.00][00:30.00]Chorus
[01:02.34]Last`;

it('writes LRC that parses back to identical cues', () => {
  const cues = parseLrc(LRC);
  expect(parseLrc(toLrc(cues))).toEqual(cues);
  expect(toLrc(cues)).toBe('[00:01.00]First line\n[00:04.50]<00:04.50>Second <00:05.25>line <00:06.00>here\n[00:08.00]\n'
    + '[00:10.00]Chorus\n[00:30.00]Chorus\n[01:02.34]Last\n');
});

it('round-trips enhanced LRC with an offset and text before the first word stamp', () => {
  const cues = parseLrc('[offset:-500]\n[00:01.00]Intro <00:02.00>word\n[00:03.00]next');
  expect(parseLrc(toLrc(cues))).toEqual(cues);
});

it('turns SRT into LRC, keeping milliseconds and gaps between cues', () => {
  const cues = parseSubtitles('1\n00:00:01,250 --> 00:00:02,000\nhi\n\n2\n00:00:03,000 --> 00:00:04,125\nyo');
  const lrc = toLrc(cues);
  expect(lrc).toBe('[00:01.25]hi\n[00:02.00]\n[00:03.00]yo\n[00:04.125]\n');
  expect(parseLrc(lrc)).toEqual(cues);
});

it('formats LRC times past an hour and clamps negatives', () => {
  expect(lrcTime(3725.5)).toBe('62:05.50');
  expect(lrcTime(-1)).toBe('00:00.00');
  expect(lrcTime(59.999)).toBe('00:59.999');
});
