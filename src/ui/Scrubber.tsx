import { useEffect, useRef, useState } from 'react';
import type { AudioTrack } from '../audio/analysis';
import { fmtTime } from './player';

/**
 * The transport's seek bar. With a song loaded it draws the whole-song
 * waveform (the same overview the progress-waveform layer uses), played part
 * in the accent colour, and the range input on top becomes the playhead.
 */
export function Scrubber({ track, time, onSeek }: { track: AudioTrack | undefined; time: number; onSeek: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const dur = track?.duration ?? 0;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), h = c.clientHeight;
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (!track) return;
    const css = getComputedStyle(c);
    const played = css.getPropertyValue('--accent').trim(), rest = css.getPropertyValue('--line-field').trim();
    // One bar every 3 CSS pixels, each the loudest overview bucket it covers.
    const step = 3 * dpr, bars = Math.floor(c.width / step), ov = track.overview;
    const playedTo = dur ? (time / dur) * bars : 0;
    for (let i = 0; i < bars; i++) {
      const from = Math.floor((i / bars) * ov.length), to = Math.max(from + 1, Math.floor(((i + 1) / bars) * ov.length));
      let m = 0;
      for (let b = from; b < to; b++) if (ov[b] > m) m = ov[b];
      const bh = Math.max(2 * dpr, m * c.height * 0.9);
      g.fillStyle = i < playedTo ? played : rest;
      g.fillRect(i * step, (c.height - bh) / 2, step - dpr, bh);
    }
  }, [track, time, dur, width]);

  return (
    <div className={`scrub ${track ? 'has-wave' : ''}`}>
      <canvas ref={canvas} />
      <input type="range" aria-label="Seek" aria-valuetext={`${fmtTime(time)} of ${fmtTime(dur)}`} min={0} max={dur || 1} step={0.01}
        value={Math.min(time, dur || 1)} disabled={!dur} onChange={(e) => onSeek(Number(e.target.value))} />
    </div>
  );
}
