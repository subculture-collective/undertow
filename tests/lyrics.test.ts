import { expect, it } from 'vitest';
import { cueAt, parseLrc, parseLyrics, parseSubtitles } from '../src/audio/lyrics';

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
