import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AudioTrack } from '../audio/analysis';
import type { AlignResult } from '../audio/lyricAlign';
import { linesFromCues, linesFromText, MIN_LINE, moveLine, setEnd, setStart, spans, stampLine, toCues, type TimedLine } from '../audio/lyricTiming';
import { cueAt, toLrc, type LyricCue, type LyricWord } from '../audio/lyrics';
import type { RuntimeAsset } from '../assets';
import { refreshMissing } from '../cloud/documents';
import { useStore } from '../store';
import type { Layer, Project } from '../types';
import { confirmAsk } from './ask';
import { Icon } from './icons';
import { LyricAlignPanel } from './LyricAlignPanel';
import { Modal } from './Modal';
import { audioEl, currentTime, usePlayer } from './player';

/**
 * The lyric timing editor: tap along to the song to stamp each line's start,
 * then drag lines on a waveform to adjust them. It edits a working copy that
 * the stage previews in place of the layer's file, and saves the result as a
 * new LRC file; the original file is never changed. Editing rules, including
 * what happens to enhanced-LRC word stamps, are in src/audio/lyricTiming.ts.
 */

export interface LyricEditorOptions {
  /** The lyrics layer that previews the edit and is pointed at the saved file. */
  layerId: string;
  /** Starting cues, for example from automatic alignment. */
  cues?: LyricCue[];
  /** Plain text, one line per cue, used when there are no cues. */
  text?: string;
  /** The source file's name; the saved file is named after it. */
  name?: string;
  /** Open on the "Align automatically" step (after pasting lines, when there are none). */
  align?: boolean;
}

interface Request extends LyricEditorOptions { id: number; resolve: (assetId: string | null) => void }

const useEditor = create<{ request: Request | null; preview: { layerId: string; cues: LyricCue[] } | null }>(() => ({
  request: null, preview: null,
}));
let nextId = 1;

/** Opens the timing editor. Resolves with the saved LRC asset's id, or null if the editor was cancelled. */
export function openLyricEditor(options: LyricEditorOptions): Promise<string | null> {
  useEditor.getState().request?.resolve(null);
  return new Promise((resolve) => useEditor.setState({ request: { ...options, id: nextId++, resolve } }));
}

/** Opens the editor on a lyrics layer's current file. A plain-text file opens as untimed lines. */
export async function editLayerTiming(layerId: string, opts: { align?: boolean } = {}): Promise<string | null> {
  const s = useStore.getState();
  const layer = s.project.layers.find((l) => l.id === layerId);
  if (layer?.type !== 'lyrics') return null;
  const asset = layer.props.assetId ? s.assets[layer.props.assetId] : undefined;
  const timed = !!asset?.cues?.length;
  return openLyricEditor({
    layerId, name: asset?.meta.name, align: opts.align,
    cues: timed ? asset!.cues : undefined,
    text: asset && !timed ? await asset.blob.text() : undefined,
  });
}

const PREVIEW_ID = 'lyric-timing-preview';

/** While the editor is open, the stage draws its working cues in place of the layer's file. */
export function withLyricPreview(project: Project, assets: Record<string, RuntimeAsset>) {
  const p = useEditor.getState().preview;
  if (!p) return { project, assets };
  return {
    project: {
      ...project,
      layers: project.layers.map((l) => (l.id === p.layerId && l.type === 'lyrics' ? { ...l, props: { ...l.props, assetId: PREVIEW_ID } } as Layer : l)),
    },
    assets: { ...assets, [PREVIEW_ID]: { cues: p.cues } as RuntimeAsset },
  };
}

/** Rendered once, in App. */
export function LyricEditorHost() {
  const request = useEditor((s) => s.request);
  return request ? <LyricTimingEditor key={request.id} request={request} /> : null;
}

const RATES = [0.5, 0.75, 1] as const;
const fmt = (t: number) => {
  const cs = Math.round(Math.max(0, t) * 100);
  return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const savedName = (name?: string) => `${(name ?? 'lyrics').replace(/\.[^.]+$/, '').replace(/ \(timed\)$/, '')} (timed).lrc`;

/** A stamped line as drawn on the timeline. `lane` alternates so neighbouring edges never sit on top of each other. */
interface Region { i: number; start: number; end: number; lane: number; text: string }
interface Snapshot { lines: TimedLine[]; cursor: number }

function LyricTimingEditor({ request }: { request: Request }) {
  const layer = useStore((s) => s.project.layers.find((l) => l.id === request.layerId));
  const offset = layer?.type === 'lyrics' ? layer.props.offset : 0;
  const audioId = useStore((s) => s.project.audioAssetId);
  const track = useStore((s) => (audioId ? s.assets[audioId]?.track : undefined));
  const playing = usePlayer((s) => s.playing);

  const initial = useMemo(() => (request.cues ? linesFromCues(request.cues) : linesFromText(request.text ?? '')), [request]);
  const [lines, setLines] = useState(initial);
  const [cursor, setCursor] = useState(() => Math.max(0, initial.findIndex((l) => l.start === null)));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [mode, setMode] = useState<'tap' | 'adjust'>(() => (!initial.length || initial.some((l) => l.start === null) ? 'tap' : 'adjust'));
  const [selected, setSelected] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [paste, setPaste] = useState<string | null>(initial.length ? null : '');
  const [saving, setSaving] = useState(false);
  const [aligning, setAligning] = useState(() => !!request.align && initial.length > 0);
  const [note, setNote] = useState<string | null>(null);
  const [t, setT] = useState(currentTime);
  useEffect(() => {
    const id = setInterval(() => setT(currentTime()), 50);
    return () => clearInterval(id);
  }, []);

  const cues = useMemo(() => toCues(lines), [lines]);
  const regions = useMemo<Region[]>(() => spans(lines).map((s, k) => ({ ...s, lane: k % 2, text: lines[s.i].text })), [lines]);

  // Live preview on the stage; the playback rate goes back to normal on close.
  useEffect(() => { useEditor.setState({ preview: { layerId: request.layerId, cues } }); }, [cues, request.layerId]);
  useEffect(() => () => { useEditor.setState({ preview: null }); audioEl.playbackRate = 1; }, []);
  useEffect(() => { audioEl.playbackRate = rate; }, [rate]);

  // ---- editing ----
  const snapshot = () => setHistory((h) => [...h.slice(-199), { lines, cursor }]);
  const commit = (next: TimedLine[], nextCursor = cursor) => { snapshot(); setLines(next); setCursor(nextCursor); };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(history.slice(0, -1));
    setLines(last.lines);
    setCursor(last.cursor);
  };
  const stamp = () => {
    if (cursor >= lines.length) return;
    commit(stampLine(lines, cursor, currentTime() - offset), cursor + 1);
    setSelected(cursor);
  };
  /** Keeps a moved line's start between its neighbours' starts, so dragging never reorders or stacks lines. */
  const moveBounds = (i: number) => {
    const k = regions.findIndex((r) => r.i === i), prev = regions[k - 1], next = regions[k + 1];
    return { lo: prev ? prev.start + MIN_LINE : 0, hi: next ? next.start - MIN_LINE : Infinity };
  };
  const moved = (orig: TimedLine, i: number, start: number) => {
    const { lo, hi } = moveBounds(i);
    return moveLine(orig, Math.min(hi, Math.max(lo, start)));
  };
  /** Applies a drag from the line as it was when the drag began. */
  const dragTo = (orig: TimedLine, origEnd: number, i: number, kind: 'move' | 'start' | 'end', dt: number) => {
    setLines((ls) => {
      const out = ls.slice();
      if (kind === 'move') out[i] = moved(orig, i, orig.start! + dt);
      else if (kind === 'end') out[i] = setEnd(orig, origEnd + dt);
      else out[i] = { ...setStart({ ...orig, end: origEnd }, Math.max(moveBounds(i).lo, orig.start! + dt)), end: orig.end };
      return out;
    });
  };
  const nudge = (d: number) => {
    const l = lines[selected];
    if (l?.start == null) return;
    const out = lines.slice();
    out[selected] = moved(l, selected, l.start + d);
    commit(out);
  };
  const setTime = (edge: 'start' | 'end', v: number) => {
    const l = lines[selected], r = regions.find((x) => x.i === selected);
    if (!l || !r) return;
    const out = lines.slice();
    out[selected] = edge === 'end' ? setEnd(l, v) : { ...setStart({ ...l, end: r.end }, v), end: l.end };
    commit(out);
  };
  const usePasted = () => {
    const next = linesFromText(paste ?? '');
    if (!next.length) return;
    commit(next, 0);
    setPaste(null);
    setSelected(0);
    setMode('tap');
    if (request.align) setAligning(true);
  };
  /** Takes the aligned lines for review. Times are song times; the layer's sync offset is taken off. */
  const aligned = (r: AlignResult) => {
    const shift = (t: number) => Math.max(0, Math.round((t - offset) * 100) / 100);
    const next = linesFromCues(r.cues.map((c) => ({ ...c, start: shift(c.start), end: shift(c.end), words: c.words?.map((w) => ({ ...w, t: shift(w.t) })) })));
    commit(next, next.length);
    setAligning(false);
    setSelected(0);
    setMode('adjust');
    const unsure = r.cues.reduce((n, c) => n + (c.words?.filter((w) => w.uncertain).length ?? 0), 0);
    setNote(`Aligned: ${r.matched} of ${r.words} words timed from the song.${unsure ? ` ${unsure} underlined word${unsure === 1 ? ' is a guess' : 's are guesses'}; check those lines.` : ''} Undo goes back.`);
  };

  // ---- playback ----
  const seek = (audioT: number) => usePlayer.getState().seek(Math.max(0, audioT));
  const playFrom = (i: number) => {
    const l = lines[i];
    if (l?.start == null) return;
    seek(l.start + offset);
    if (!usePlayer.getState().playing) usePlayer.getState().toggle();
  };
  const pickLine = (i: number) => {
    setCursor(i);
    setSelected(i);
    // Re-stamping from here: start a little before the line.
    const s = lines[i].start;
    if (s !== null) seek(s + offset - 2);
  };

  // ---- closing ----
  const finish = (id: string | null) => { useEditor.setState({ request: null }); request.resolve(id); };
  const cancel = async () => {
    if (history.length && !(await confirmAsk({
      title: 'Discard timing changes?', body: 'Nothing has been saved. The lyrics layer keeps its current file.', action: 'Discard', danger: true,
    }))) return;
    finish(null);
  };
  const save = async () => {
    setSaving(true);
    try {
      const file = new File([toLrc(cues)], savedName(request.name), { type: 'text/plain' });
      const [asset] = await useStore.getState().importFiles([file]);
      if (!asset) return;
      if (useStore.getState().project.layers.some((l) => l.id === request.layerId)) {
        useStore.getState().updateProps(request.layerId, { assetId: asset.meta.id });
      }
      refreshMissing();
      finish(asset.meta.id);
    } finally {
      setSaving(false);
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toLrc(cues)], { type: 'text/plain' }));
    a.download = savedName(request.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // Space stamps in tap mode and plays or pauses in adjust mode; Ctrl/⌘Z undoes. Text fields keep their keys.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const el = e.target as HTMLElement;
    if (!el.closest('.lyric-editor') || el.closest('textarea, input:not([type=range])')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.type === 'keydown') undo(); }
    else if (e.key === ' ') {
      // Also on keyup, where a focused button would otherwise take Space as a click.
      e.preventDefault();
      if (e.type !== 'keydown' || e.repeat || paste !== null || aligning) return;
      if (mode === 'tap') stamp(); else usePlayer.getState().toggle();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    window.addEventListener('keyup', h);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('keyup', h); };
  }, []);

  const showing = cueAt(cues, t - offset);
  const playingLine = showing < 0 ? -1 : lines.findIndex((l) => l.start === cues[showing].start && l.text === cues[showing].text);
  const untimed = lines.filter((l) => l.start === null).length;
  const sel = regions.find((r) => r.i === selected);

  return (
    <Modal className="lyric-editor" backClassName="dock" labelledBy="lyric-editor-title" onClose={() => void cancel()} locked={saving}>
      <div className="lyric-editor-head">
        <h3 id="lyric-editor-title">Lyric timing</h3>
        <div className="tabs" role="tablist" aria-label="Mode">
          {(['tap', 'adjust'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''}
              disabled={paste !== null || aligning} onClick={() => setMode(m)}>{m === 'tap' ? 'Tap' : 'Adjust'}</button>
          ))}
        </div>
        <span className="grow" />
        <button type="button" className="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => usePlayer.getState().toggle()}>
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <span className="time" aria-label="Playback time">{fmt(t)}</span>
        <div className="tabs" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button key={r} type="button" aria-pressed={rate === r} className={rate === r ? 'active' : ''} onClick={() => setRate(r)}>{r}×</button>
          ))}
        </div>
      </div>

      {paste !== null ? (
        <div className="lyric-paste">
          <label className="field">Lyrics, one line per cue
            <textarea rows={8} value={paste} autoFocus onChange={(e) => setPaste(e.target.value)} />
          </label>
          {lines.length > 0 && <p className="hint">These replace the current {lines.length} lines and their times. Undo brings them back.</p>}
          <div className="buttons">
            <button type="button" onClick={usePasted} disabled={!linesFromText(paste).length}>Use these lines</button>
            {lines.length > 0 && <button type="button" onClick={() => setPaste(null)}>Keep current lines</button>}
          </div>
        </div>
      ) : aligning ? (
        <LyricAlignPanel assetId={audioId ?? undefined} track={track} text={lines.map((l) => l.text).join('\n')} lineCount={lines.length}
          onDone={aligned} onClose={() => setAligning(false)} />
      ) : mode === 'tap' ? (
        <TapPanel lines={lines} cursor={cursor} playingLine={playingLine} hasSong={!!track} onPick={pickLine} onStamp={stamp} />
      ) : (
        <div className="lyric-adjust">
          <Timeline track={track} regions={regions} selected={selected} offset={offset} time={t} playing={playing}
            onSelect={setSelected} onBegin={snapshot} onDrag={(r, kind, dt) => dragTo(r.orig, r.end, r.i, kind, dt)}
            lineOf={(i) => lines[i]} onSeek={seek} onPlay={playFrom} onNudge={nudge} />
          {sel ? (
            <div className="lyric-selected">
              <span className="lyric-selected-text"><strong>Line {selected + 1}</strong> <LineText line={lines[selected]} /></span>
              <TimeField label="Start" value={sel.start} onCommit={(v) => setTime('start', v)} />
              <TimeField label="End" value={sel.end} onCommit={(v) => setTime('end', v)} />
              <button type="button" onClick={() => nudge(-0.01)}>−10 ms</button>
              <button type="button" onClick={() => nudge(0.01)}>+10 ms</button>
              <button type="button" onClick={() => playFrom(selected)}><Icon name="play" size={12} /> Play line</button>
            </div>
          ) : <p className="hint">Pick a line on the timeline.</p>}
          {note && <p className="hint" role="status">{note}</p>}
          <p className="hint" id="lyric-timeline-help">
            Drag a line to move it, or drag its ends. Click a line to play from it. With the timeline focused, ↑ and ↓ pick a line
            and ← and → move it by 10 ms (100 ms with Shift). Ctrl or ⌘ with the scroll wheel zooms.
            {untimed > 0 && ` ${untimed} line${untimed === 1 ? ' has' : 's have'} no time yet; stamp ${untimed === 1 ? 'it' : 'them'} in Tap.`}
          </p>
        </div>
      )}

      <div className="buttons end lyric-editor-foot">
        <button type="button" onClick={undo} disabled={!history.length}><Icon name="undo" size={14} /> Undo</button>
        <button type="button" onClick={() => setPaste('')} disabled={paste !== null || aligning}>Paste lines…</button>
        <button type="button" title="Time the lines and words from the song with a speech model that runs in this browser"
          onClick={() => setAligning(true)} disabled={paste !== null || aligning || !lines.length}>Align automatically…</button>
        <button type="button" onClick={download} disabled={!cues.length}><Icon name="download" size={14} /> Download .lrc</button>
        <span className="grow" />
        <button type="button" onClick={() => void cancel()}>Cancel</button>
        <button type="button" className="primary" onClick={() => void save()} disabled={!cues.length || saving}>Save as new LRC</button>
      </div>
    </Modal>
  );
}

function TapPanel({ lines, cursor, playingLine, hasSong, onPick, onStamp }: {
  lines: TimedLine[]; cursor: number; playingLine: number; hasSong: boolean; onPick: (i: number) => void; onStamp: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.children[cursor]?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  const next = lines[cursor];
  return (
    <div className="lyric-tap">
      <ol className="lyric-lines" ref={list} aria-label="Lines">
        {lines.map((l, i) => (
          <li key={i} className={`${i === cursor ? 'next' : ''} ${i === playingLine ? 'playing' : ''}`}>
            <button type="button" aria-current={i === cursor ? 'step' : undefined} onClick={() => onPick(i)}>
              <span className="lyric-time">{l.start === null ? '–' : fmt(l.start)}</span>
              <span className="lyric-text"><LineText line={l} /></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="lyric-tap-side">
        <button type="button" className="lyric-tap-button" onClick={onStamp} disabled={!next}>
          {next ? <>Stamp line {cursor + 1}<small>{next.text}</small></> : 'All lines stamped'}
        </button>
        <p className="hint">
          Play the song and press Space as each line starts. Pick a line in the list to stamp again from there.
          {!hasSong && ' Add your song first; without it the stamps follow a silent clock.'}
        </p>
      </div>
    </div>
  );
}

/** A line's text, with words that automatic alignment only guessed underlined. */
function LineText({ line }: { line: { text: string; words?: LyricWord[] } }) {
  if (!line.words?.some((w) => w.uncertain)) return <>{line.text}</>;
  return <>{line.words.map((w, i) => w.uncertain
    ? <span key={i}><span className="lyric-unsure" title="Timing guessed: check this word">{w.text.trimEnd()}</span>{w.text.slice(w.text.trimEnd().length)}</span>
    : <span key={i}>{w.text}</span>)}</>;
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const done = () => {
    const v = Number(text);
    if (text.trim() && Number.isFinite(v) && Math.abs(v - value) >= 0.005) onCommit(v);
    else setText(value.toFixed(2));
  };
  return (
    <label className="field">{label} (s)
      <input type="number" step={0.01} min={0} value={text} onChange={(e) => setText(e.target.value)} onBlur={done}
        onKeyDown={(e) => { if (e.key === 'Enter') done(); }} />
    </label>
  );
}

type DragKind = 'move' | 'start' | 'end';
interface Drag { r: { i: number; orig: TimedLine; end: number }; kind: DragKind | 'seek'; x: number; moved: boolean }

/**
 * The adjust-mode timeline: the song's waveform with each stamped line as a
 * region. Times on it are song times; cue times are shifted by the layer's
 * sync offset.
 */
function Timeline({ track, regions, selected, offset, time, playing, onSelect, onBegin, onDrag, lineOf, onSeek, onPlay, onNudge }: {
  track: AudioTrack | undefined; regions: Region[]; selected: number; offset: number; time: number; playing: boolean;
  onSelect: (i: number) => void; onBegin: () => void; onDrag: (r: Drag['r'], kind: DragKind, dt: number) => void;
  lineOf: (i: number) => TimedLine; onSeek: (t: number) => void; onPlay: (i: number) => void; onNudge: (d: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const duration = track?.duration ?? Math.max(30, (regions[regions.length - 1]?.end ?? 0) + offset + 5);
  const [view, setView] = useState(() => {
    const span = Math.min(duration, 30);
    const first = regions.find((r) => r.i === selected) ?? regions[0];
    return { start: Math.max(0, Math.min(duration - span, (first?.start ?? 0) + offset - 2)), span };
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const setClamped = (start: number, span: number) => {
    span = Math.min(duration, Math.max(2, span));
    setView({ start: Math.max(0, Math.min(duration - span, start)), span });
  };
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(c);
    // Wheel needs a non-passive listener to keep the dialog from scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current, rect = c.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const at = v.start + ((e.clientX - rect.left) / rect.width) * v.span;
        const span = v.span * Math.exp(e.deltaY * 0.002);
        const k = (at - v.start) / v.span;
        setClamped(at - k * Math.min(duration, Math.max(2, span)), span);
      } else {
        setClamped(v.start + ((e.deltaX || e.deltaY) / rect.width) * v.span, v.span);
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); c.removeEventListener('wheel', onWheel); };
  }, [duration]);

  // Follow the playhead while playing, and bring a newly picked line into view.
  useEffect(() => {
    if (playing && (time < view.start || time > view.start + view.span)) setClamped(time - view.span * 0.1, view.span);
  }, [time, playing]);
  useEffect(() => {
    const r = regions.find((x) => x.i === selected);
    if (r && (r.start + offset < view.start || r.start + offset > view.start + view.span)) setClamped(r.start + offset - view.span * 0.2, view.span);
  }, [selected]);

  // Peak per pixel column: from the whole-song overview when zoomed out, from the samples when zoomed in.
  const peaks = useMemo(() => {
    const out = new Float32Array(width);
    if (!track || !width) return out;
    const ov = track.overview, sr = track.sampleRate, buf = track.buffer;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const perPx = view.span / width;
    const fromOverview = perPx * sr >= L.length / ov.length;
    for (let x = 0; x < width; x++) {
      const t0 = view.start + x * perPx, t1 = t0 + perPx;
      let m = 0;
      if (fromOverview) {
        const a = Math.floor((t0 / track.duration) * ov.length), b = Math.max(a + 1, Math.floor((t1 / track.duration) * ov.length));
        for (let i = Math.max(0, a); i < Math.min(ov.length, b); i++) if (ov[i] > m) m = ov[i];
      } else {
        for (let i = Math.max(0, Math.floor(t0 * sr)), end = Math.min(L.length, Math.ceil(t1 * sr)); i < end; i++) {
          const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
          if (v > m) m = v;
        }
      }
      out[x] = m;
    }
    return out;
  }, [track, view, width]);

  const xOf = (songT: number) => ((songT - view.start) / view.span) * width;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), h = c.clientHeight;
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c), col = (n: string) => css.getPropertyValue(n).trim();
    g.fillStyle = col('--surface-sunken');
    g.fillRect(0, 0, width, h);
    g.fillStyle = col('--line-strong');
    for (let x = 0; x < width; x++) {
      const bh = Math.max(1, peaks[x] * h * 0.9);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
    g.font = `12px ${col('--font-ui')}`;
    g.textBaseline = 'middle';
    const laneH = h / 2;
    for (const r of regions) {
      const x0 = xOf(r.start + offset), x1 = xOf(r.end + offset);
      if (x1 < 0 || x0 > width) continue;
      const y = r.lane * laneH + 2, rh = laneH - 4, w = Math.max(2, x1 - x0), on = r.i === selected;
      g.fillStyle = col('--accent-soft');
      g.fillRect(x0, y, w, rh);
      g.strokeStyle = on ? col('--accent-2') : col('--accent-line');
      g.lineWidth = on ? 2 : 1;
      g.strokeRect(x0 + 0.5, y + 0.5, w - 1, rh - 1);
      // Edge grips.
      g.fillStyle = on ? col('--accent-2') : col('--accent');
      g.fillRect(x0, y, 3, rh);
      g.fillRect(x0 + w - 3, y, 3, rh);
      g.save();
      g.beginPath();
      g.rect(x0 + 6, y, Math.max(0, w - 12), rh);
      g.clip();
      g.fillStyle = col('--text');
      g.fillText(r.text, x0 + 8, y + rh / 2);
      g.restore();
    }
    const px = xOf(time);
    g.fillStyle = col('--text');
    g.fillRect(Math.round(px) - 1, 0, 2, h);
  }, [peaks, regions, selected, offset, time, view, width]);

  const hit = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, lane = e.clientY - rect.top > rect.height / 2 ? 1 : 0;
    const tol = e.pointerType === 'mouse' ? 6 : 14;
    for (const r of regions) {
      if (r.lane !== lane) continue;
      const x0 = xOf(r.start + offset), x1 = xOf(r.end + offset), edge = Math.min(tol, (x1 - x0) / 3);
      if (Math.abs(x - x0) <= edge) return { r, kind: 'start' as const };
      if (Math.abs(x - x1) <= edge) return { r, kind: 'end' as const };
      if (x >= x0 && x <= x1) return { r, kind: 'move' as const };
    }
    return null;
  };
  const songTimeAt = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    return view.start + ((clientX - rect.left) / rect.width) * view.span;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = hit(e);
    if (h) {
      onSelect(h.r.i);
      drag.current = { r: { i: h.r.i, orig: lineOf(h.r.i), end: h.r.end }, kind: h.kind, x: e.clientX, moved: false };
    } else {
      drag.current = { r: { i: -1, orig: { text: '', start: null, end: null }, end: 0 }, kind: 'seek', x: e.clientX, moved: false };
      onSeek(songTimeAt(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      const h = hit(e);
      e.currentTarget.style.cursor = !h ? 'text' : h.kind === 'move' ? 'grab' : 'ew-resize';
      return;
    }
    if (d.kind === 'seek') { onSeek(songTimeAt(e.clientX)); return; }
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) onBegin();
    d.moved = true;
    onDrag(d.r, d.kind, (dx / e.currentTarget.getBoundingClientRect().width) * view.span);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== 'seek' && !d.moved) onPlay(d.r.i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = regions.findIndex((r) => r.i === selected);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = regions[Math.min(regions.length - 1, Math.max(0, (k < 0 ? 0 : k) + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onSelect(next.i);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onNudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01));
    } else if (e.key === 'Enter' && k >= 0) {
      e.preventDefault();
      onPlay(selected);
    }
  };

  return (
    <>
      <canvas ref={canvas} className="lyric-timeline" tabIndex={0} aria-label="Lyric timeline" aria-describedby="lyric-timeline-help"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown} />
      <div className="lyric-zoom">
        <button type="button" onClick={() => setClamped(view.start - view.span / 2, view.span * 2)} disabled={view.span >= duration}>Zoom out</button>
        <button type="button" onClick={() => setClamped(view.start + view.span / 4, view.span / 2)} disabled={view.span <= 2}>Zoom in</button>
        <button type="button" onClick={() => setClamped(0, duration)}>Whole song</button>
        <input type="range" aria-label="Scroll timeline" min={0} max={Math.max(0, duration - view.span)} step={0.01}
          value={view.start} disabled={view.span >= duration} onChange={(e) => setClamped(Number(e.target.value), view.span)} />
      </div>
    </>
  );
}

