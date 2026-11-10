import { expect, it } from 'vitest';
import { linesFromCues, linesFromText, moveLine, setEnd, setStart, stampLine, toCues } from '../src/audio/lyricTiming';
import { parseLrc, parseSubtitles, toLrc } from '../src/audio/lyrics';

it('saves unedited lines as LRC that parses back to the same cues', () => {
  const cues = parseLrc('[00:01.00]One\n[00:02.50]<00:02.50>Two <00:03.10>words\n[00:06.00]\n[00:07.00]Three');
  expect(parseLrc(toLrc(toCues(linesFromCues(cues))))).toEqual(cues);
});

it('stamps pasted lines in order and ends each at the next stamp', () => {
  let lines = linesFromText('  first \n\nsecond\nthird\n');
  expect(lines.map((l) => l.text)).toEqual(['first', 'second', 'third']);
  lines = stampLine(lines, 0, 1.234);
  lines = stampLine(lines, 1, 3.5);
  expect(toCues(lines)).toEqual([
    { start: 1.23, end: 3.5, text: 'first' },
    { start: 3.5, end: 8.5, text: 'second' },
  ]);
  expect(toLrc(toCues(lines))).toBe('[00:01.23]first\n[00:03.50]second\n');
});

it('moves word stamps with a moved line and leaves them on an edge drag', () => {
  const [line] = linesFromCues(parseLrc('[00:10.00]<00:10.00>a <00:11.00>b\n[00:15.00]x'));
  const moved = moveLine(line, 12);
  expect([moved.start, moved.end]).toEqual([12, 17]);
  expect(moved.words?.map((w) => w.t)).toEqual([12, 13]);
  expect(setStart(line, 10.5).words?.map((w) => w.t)).toEqual([10, 11]);
});

it('keeps a minimum length when dragging edges', () => {
  const line = { text: 'x', start: 2, end: 3 };
  expect(setStart(line, 5).start).toBe(2.95);
  expect(setEnd(line, 0).end).toBe(2.05);
});

it('edits SRT cues and saves them as LRC with their gaps', () => {
  const cues = parseSubtitles('00:00:01,000 --> 00:00:02,000\nhi\n\n00:00:04,000 --> 00:00:05,000\nyo');
  const lines = linesFromCues(cues);
  lines[1] = moveLine(lines[1], 4.5);
  expect(parseLrc(toLrc(toCues(lines)))).toEqual([
    { start: 1, end: 2, text: 'hi', words: undefined },
    { start: 4.5, end: 5.5, text: 'yo', words: undefined },
  ]);
});

it('ends a line no later than the next one starts, as LRC will', () => {
  const lines = linesFromCues(parseLrc('[00:01.00]a\n[00:03.00]b\n[00:05.00]c'));
  lines[0] = moveLine(lines[0], 1.5);
  expect(lines[0].end).toBe(3.5);
  const cues = toCues(lines);
  expect(cues.map((c) => [c.start, c.end])).toEqual([[1.5, 3], [3, 5], [5, 10]]);
  expect(parseLrc(toLrc(cues))).toEqual(cues.map((c) => ({ ...c, words: undefined })));
});
