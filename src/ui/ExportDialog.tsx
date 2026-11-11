import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../cloud/account';
import { loadUsage, submitRender, useRenders, type RenderJob, type Usage } from '../cloud/renders';
import { getFirstEncodableVideoCodec } from 'mediabunny';
import type { Container } from '../export/blobOutput';
import { CONTAINER_CODECS, exportVideo, type ExportOptions, type ExportProgress } from '../export/exportVideo';
import { layerSource } from '../audio/stems';
import { useStore } from '../store';
import { ASPECTS, ASPECT_IDS, type AspectId } from '../types';
import { BRAND, visibleLink } from '../brand';
import { PatreonButton } from './Brand';
import { Row, Select } from './controls';
import { audioEl, fmtTime } from './player';
import { RenderRow } from './RendersDialog';
import { Icon } from './icons';
import { Modal } from './Modal';

interface Result { aspect: AspectId; url: string; size: number; silent: boolean; container: Container; videoCodec: string; audioCodec: string | null }

const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', aac: 'AAC', opus: 'Opus' };
const codecName = (c: string) => CODEC_NAMES[c] ?? c;

/** Which containers this browser can encode at the chosen size, and whether MP4 gets H.264/HEVC or falls back to VP9/AV1. */
function useEncodeSupport(shortSide: ExportOptions['shortSide']) {
  const [support, setSupport] = useState<{ webm: boolean; mp4Native: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const size = { width: Math.round((shortSide * 16) / 9 / 2) * 2, height: shortSide };
    Promise.all([
      getFirstEncodableVideoCodec([...CONTAINER_CODECS.webm.video], size),
      getFirstEncodableVideoCodec(['avc', 'hevc'], size),
    ]).then(([webm, native]) => { if (live) setSupport({ webm: !!webm, mp4Native: !!native }); })
      .catch(() => { if (live) setSupport({ webm: false, mp4Native: true }); });
    return () => { live = false; };
  }, [shortSide]);
  return support;
}

type Where = 'local' | 'cloud';

export function ExportDialog({ onClose, onSignIn, onBilling }: { onClose: () => void; onSignIn: () => void; onBilling: () => void }) {
  const project = useStore((s) => s.project);
  const assets = useStore((s) => s.assets);
  const current = useStore((s) => s.aspect);
  const track = project.audioAssetId ? assets[project.audioAssetId]?.track ?? null : null;
  const duration = track?.duration ?? 15;
  const stemLayers = project.layers.filter((l) => l.visible && layerSource(l) !== 'mix').length;
  const stemsReady = !!(project.audioAssetId && assets[project.audioAssetId]?.stems);

  const [aspects, setAspects] = useState<AspectId[]>([current]);
  const [shortSide, setShortSide] = useState<ExportOptions['shortSide']>(1080);
  const [fps, setFps] = useState<ExportOptions['fps']>(30);
  const [quality, setQuality] = useState<ExportOptions['quality']>('high');
  const [range, setRange] = useState<'full' | 'preview'>('full');
  const [chosenContainer, setContainer] = useState<Container>('mp4');
  const support = useEncodeSupport(shortSide);
  // Only offer WebM where VP9 or AV1 can be encoded; otherwise MP4 is the only choice.
  const container: Container = support?.webm ? chosenContainer : 'mp4';
  const [progress, setProgress] = useState<(ExportProgress & { aspect: AspectId }) | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultUrls = useRef<string[]>([]);
  const clearResults = () => {
    resultUrls.current.forEach((url) => URL.revokeObjectURL(url));
    resultUrls.current = [];
    setResults([]);
  };
  useEffect(() => () => {
    abort.current?.abort();
    resultUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  // Cloud rendering: signed in, and a plan with render minutes.
  const signedIn = useAccount((s) => s.status === 'signed-in');
  // No account API (the standalone editor): cloud rendering isn't offered at all.
  const cloudOffered = useAccount((s) => !s.offline);
  const retentionDays = useAccount((s) => s.renderOutputDays);
  const [where, setWhere] = useState<Where>('local');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [upload, setUpload] = useState<{ sent: number; total: number; aspect: AspectId } | null>(null);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const jobs = useRenders((s) => s.jobs);
  useEffect(() => {
    if (where === 'cloud' && signedIn) loadUsage().then(setUsage).catch((e) => setError((e as Error).message));
  }, [where, signedIn]);
  const limits = usage?.limits;
  const minutesLeft = usage && limits ? Math.max(0, limits.renderMinutesPerMonth * 60 - usage.renderSecondsThisMonth) / 60 : 0;
  const cloudAllowed = !!limits && limits.renderMinutesPerMonth > 0;

  const start = range === 'full' ? 0 : Math.min(audioEl.currentTime || 0, Math.max(0, duration - 1));
  const end = range === 'full' ? duration : Math.min(duration, start + 15);

  const run = async () => {
    if (abort.current) return;
    setError(''); clearResults();
    audioEl.pause();
    abort.current = new AbortController();
    setRendering(true);
    try {
      for (const aspect of aspects) {
        const res = await exportVideo(project, track, assets, { aspect, shortSide, fps, quality, start, end, container },
          (p) => setProgress({ ...p, aspect }), abort.current.signal);
        if (abort.current.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const silent = !!track && !res.audioCodec;
        const url = URL.createObjectURL(res.blob);
        resultUrls.current.push(url);
        setResults((r) => [...r, {
          aspect, url, size: res.blob.size, silent, container: res.container, videoCodec: res.videoCodec, audioCodec: res.audioCodec,
        }]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRendering(false);
      setProgress(null);
      abort.current = null;
    }
  };

  const runCloud = async () => {
    setError(''); setSubmitted([]);
    try {
      for (const aspect of aspects) {
        const job = await submitRender(project, assets, { aspect, shortSide, fps, quality, start, end },
          (sent, total) => setUpload({ sent, total, aspect }));
        setSubmitted((s) => [...s, job.id]);
      }
      setUsage(await loadUsage());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpload(null);
    }
  };

  const base = project.name.replace(/[^\w\- ]+/g, '').trim() || 'visualizer';
  const busy = rendering || !!upload;
  const cloudSeconds = Math.ceil(end - start) * aspects.length;
  const tooBig = where === 'cloud' && !!limits && shortSide > limits.renderMaxShortSide;
  const tooLong = where === 'cloud' && !!limits && end - start > limits.renderMaxSeconds;
  const noMinutes = where === 'cloud' && !!usage && cloudSeconds > minutesLeft * 60;
  const myJobs = jobs.filter((j): j is RenderJob => submitted.includes(j.id));

  return (
    <Modal labelledBy="export-title" onClose={onClose} locked={busy}>
      <h3 id="export-title">Export video</h3>
      {cloudOffered && (
        <div className="tabs export-where">
          <button className={where === 'local' ? 'active' : ''} disabled={busy} onClick={() => setWhere('local')}>On this computer</button>
          <button className={where === 'cloud' ? 'active' : ''} disabled={busy} onClick={() => setWhere('cloud')}>In the cloud</button>
        </div>
      )}
      {where === 'cloud' && !signedIn && (
        <div className="support-nudge">
          <p>Cloud rendering runs on {BRAND.name}'s servers, so you can close the tab while it works. It needs an account whose plan includes it. Sign in to check yours.</p>
          <button className="sm primary" onClick={() => { onClose(); onSignIn(); }}>Sign in</button>
        </div>
      )}
      {where === 'cloud' && signedIn && usage && !cloudAllowed && (
        <div className="support-nudge">
          <p>Your plan doesn't include cloud rendering. Billing shows whether Creator is open yet. Rendering on this computer is free either way.</p>
          <button className="sm primary" onClick={onBilling}>Open Billing</button>
        </div>
      )}
      {where === 'cloud' && cloudAllowed && limits && (
        <p className="hint">
          {minutesLeft.toFixed(1)} of {limits.renderMinutesPerMonth} cloud minutes left this month.
          {' '}This export uses {Math.ceil(cloudSeconds / 60 * 10) / 10} min. Your files are uploaded for this render only and deleted when it finishes.
        </p>
      )}
      {!track && <p className="warn">No song loaded. The video will be silent and 15 seconds long.</p>}
      {track && stemLayers > 0 && where === 'local' && !stemsReady && (
        <p className="warn">{stemLayers === 1 ? 'A layer follows a stem' : `${stemLayers} layers follow stems`}, but this song's stems aren't separated, so they react to the whole song. Separate stems from the layer's settings first.</p>
      )}
      {track && stemLayers > 0 && where === 'cloud' && (
        <p className="warn">Cloud renders don't use stems yet: layers set to a stem react to the whole song.</p>
      )}
      <Row label="Formats" group>
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
      {where === 'local' && support?.webm && (
        <Select label="File type" value={container} onChange={setContainer}
          options={[['mp4', 'MP4'], ['webm', 'WebM (VP9 or AV1, Opus audio)']] as const} />
      )}
      {where === 'local' && support && !support.mp4Native && container === 'mp4' && (
        <p className="warn">
          This browser can't encode H.264 at this size, so the MP4 will hold {support.webm ? 'VP9 or AV1' : 'other'} video, which some players and editors handle poorly.
          {support.webm && ' WebM is the usual container for it.'}
        </p>
      )}
      <Select label="Length" value={range} onChange={setRange}
        options={[['full', track ? `Whole song (${fmtTime(duration)})` : `Silent video (${fmtTime(duration)})`], ['preview', `15 s from playhead (${fmtTime(start)})`]] as const} />

      {upload && (
        <div className="progress">
          <div className="bar"><div style={{ width: `${(upload.sent / Math.max(1, upload.total)) * 100}%` }} /></div>
          <span>{ASPECTS[upload.aspect].label}: uploading files · {(upload.sent / 1e6).toFixed(1)} of {(upload.total / 1e6).toFixed(1)} MB</span>
        </div>
      )}
      {myJobs.length > 0 && <ul className="render-list">{myJobs.map((j) => <RenderRow key={j.id} job={j} />)}</ul>}
      {tooBig && <p className="warn">Your plan renders up to {limits!.renderMaxShortSide}p in the cloud.</p>}
      {tooLong && <p className="warn">Your plan renders up to {Math.floor(limits!.renderMaxSeconds / 60)} minutes per video in the cloud.</p>}
      {noMinutes && <p className="warn">Not enough cloud minutes left this month for this export.</p>}
      {progress && (
        <div className="progress">
          <div className="bar"><div style={{ width: `${(progress.frame / progress.frames) * 100}%` }} /></div>
          <span>{ASPECTS[progress.aspect].label}: frame {progress.frame}/{progress.frames} · {progress.fps.toFixed(1)} fps · about {fmtTime(progress.eta)} left</span>
        </div>
      )}
      {error && <p className="warn">{error}</p>}
      {results.map((r) => (
        <p key={r.aspect}>
          <a className="download" href={r.url} download={`${base}-${r.aspect}.${r.container}`}><Icon name="download" /> Download {ASPECTS[r.aspect].label}</a>
          <span className="hint">
            {' '}{r.container === 'webm' ? 'WebM' : 'MP4'} · {codecName(r.videoCodec)}{r.audioCodec ? ` + ${codecName(r.audioCodec)}` : ''} · {(r.size / 1e6).toFixed(1)} MB
          </span>
          {r.silent && <span className="warn"> · silent: this browser has no audio encoder</span>}
        </p>
      ))}
      {results.length > 0 && !busy && visibleLink(BRAND.patreon) && (
        <div className="support-nudge">
          <p>{BRAND.name} is free, with or without Patreon. Support there pays for the work on it.</p>
          <PatreonButton small />
        </div>
      )}
      <p className="hint">
        {where === 'local'
          ? 'It renders on this computer, and your audio doesn’t leave it. Speed depends on the browser and the device. Keep this tab open until it finishes.'
          : `Cloud renders keep going if you close this. Find them in your account menu under Cloud renders. Videos are kept for ${retentionDays} days.`}
      </p>
      <div className="buttons end">
        {rendering
          ? <button onClick={() => abort.current?.abort()}>Cancel</button>
          : <>
              <button onClick={onClose} disabled={!!upload}>Close</button>
              {where === 'local'
                ? <button className="primary" disabled={!aspects.length} onClick={run}>Render</button>
                : <button className="primary" disabled={!aspects.length || !cloudAllowed || busy || tooBig || tooLong || noMinutes} onClick={runCloud}>
                    {upload ? 'Uploading…' : 'Render in the cloud'}
                  </button>}
            </>}
      </div>
    </Modal>
  );
}
