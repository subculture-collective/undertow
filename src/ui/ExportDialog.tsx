import { useRef, useState } from 'react';
import { exportVideo, type ExportOptions, type ExportProgress } from '../export/exportVideo';
import { useStore } from '../store';
import { ASPECTS, ASPECT_IDS, type AspectId } from '../types';
import { BRAND, visibleLink } from '../brand';
import { PatreonButton } from './Brand';
import { Row, Select } from './controls';
import { audioEl, fmtTime } from './player';

interface Result { aspect: AspectId; url: string; size: number; silent: boolean }

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const assets = useStore((s) => s.assets);
  const current = useStore((s) => s.aspect);
  const track = project.audioAssetId ? assets[project.audioAssetId]?.track ?? null : null;
  const duration = track?.duration ?? 15;

  const [aspects, setAspects] = useState<AspectId[]>([current]);
  const [shortSide, setShortSide] = useState<ExportOptions['shortSide']>(1080);
  const [fps, setFps] = useState<ExportOptions['fps']>(30);
  const [quality, setQuality] = useState<ExportOptions['quality']>('high');
  const [range, setRange] = useState<'full' | 'preview'>('full');
  const [progress, setProgress] = useState<(ExportProgress & { aspect: AspectId }) | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const start = range === 'full' ? 0 : Math.min(audioEl.currentTime || 0, Math.max(0, duration - 1));
  const end = range === 'full' ? duration : Math.min(duration, start + 15);

  const run = async () => {
    setError(''); setResults([]);
    audioEl.pause();
    abort.current = new AbortController();
    try {
      for (const aspect of aspects) {
        const res = await exportVideo(project, track, assets, { aspect, shortSide, fps, quality, start, end },
          (p) => setProgress({ ...p, aspect }), abort.current.signal);
        const silent = !!track && !res.audioCodec;
        setResults((r) => [...r, { aspect, url: URL.createObjectURL(res.blob), size: res.blob.size, silent }]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const base = project.name.replace(/[^\w\- ]+/g, '').trim() || 'visualizer';
  const busy = !!progress;

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <h3>Export video</h3>
        {!track && <p className="warn">No song loaded. The video will be silent and 15 seconds long.</p>}
        <Row label="Formats">
          <span className="checks">
            {ASPECT_IDS.map((a) => (
              <label key={a}>
                <input type="checkbox" disabled={busy} checked={aspects.includes(a)}
                  onChange={(e) => setAspects((s) => (e.target.checked ? [...s, a] : s.filter((x) => x !== a)))} />
                {ASPECTS[a].label}
              </label>
            ))}
          </span>
        </Row>
        <Select label="Resolution" value={shortSide} onChange={setShortSide}
          options={[[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']] as const} />
        <Select label="Frame rate" value={fps} onChange={setFps} options={[[24, '24 fps'], [30, '30 fps'], [60, '60 fps']] as const} />
        <Select label="Quality" value={quality} onChange={setQuality} options={[['high', 'High'], ['very-high', 'Very high (bigger file)']] as const} />
        <Select label="Length" value={range} onChange={setRange}
          options={[['full', `Whole song (${fmtTime(duration)})`], ['preview', `15 s from playhead (${fmtTime(start)})`]] as const} />

        {progress && (
          <div className="progress">
            <div className="bar"><div style={{ width: `${(progress.frame / progress.frames) * 100}%` }} /></div>
            <span>{ASPECTS[progress.aspect].label}: frame {progress.frame}/{progress.frames} · {progress.fps.toFixed(1)} fps · about {fmtTime(progress.eta)} left</span>
          </div>
        )}
        {error && <p className="warn">{error}</p>}
        {results.map((r) => (
          <p key={r.aspect}>
            <a className="download" href={r.url} download={`${base}-${r.aspect}.mp4`}>⬇ Download {ASPECTS[r.aspect].label}</a>
            <span className="hint"> {(r.size / 1e6).toFixed(1)} MB</span>
            {r.silent && <span className="warn"> · silent: this browser has no audio encoder</span>}
          </p>
        ))}
        {results.length > 0 && !busy && visibleLink(BRAND.patreon) && (
          <div className="support-nudge">
            <p>Happy with the result? {BRAND.name} is free, and Patreon support pays for new features.</p>
            <PatreonButton small />
          </div>
        )}
        <p className="hint">Rendering happens on this computer. Keep this tab open until it finishes.</p>
        <div className="buttons end">
          {busy
            ? <button onClick={() => abort.current?.abort()}>Cancel</button>
            : <>
                <button onClick={onClose}>Close</button>
                <button className="primary" disabled={!aspects.length} onClick={run}>Render</button>
              </>}
        </div>
      </div>
    </div>
  );
}
