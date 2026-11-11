import { useEffect, useRef, useState } from 'react';
import type { AudioTrack } from '../audio/analysis';
import type { AlignResult } from '../audio/lyricAlign';
import {
  ALIGN_MODELS, alignErrorMessage, alignToSong, alignUnsupported, DEFAULT_ALIGN_MODEL, isModelCached,
  type AlignModel, type AlignProgress,
} from '../audio/lyricAlignClient';
import { cancelStems, isModelCached as isStemModelCached, separateStems, stemSupportProblem, useStemState } from '../audio/stemSeparation';
import { stemDownloadMB } from '../audio/stems';
import { useStore } from '../store';
import { Select } from './controls';

/**
 * The "Align automatically" step of the lyric timing editor: picks a speech
 * model, says what it downloads, and runs alignment with progress and cancel.
 * The result goes back to the editor for review.
 */
const MODEL_KEY = 'undertow.alignModel';
/** The model picked last in this browser, so a downloaded larger model stays the choice. */
function savedModel(): AlignModel {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    if (ALIGN_MODELS.some((x) => x.id === m)) return m as AlignModel;
  } catch { /* storage unavailable */ }
  return DEFAULT_ALIGN_MODEL;
}
const saveModel = (m: AlignModel) => { try { localStorage.setItem(MODEL_KEY, m); } catch { /* storage unavailable */ } };

type Listen = 'vocals' | 'mix';
type Progress = AlignProgress | { stage: 'separate'; progress: number };

/** Separates the song's stems if needed and resolves with its vocals; rejects with an AbortError when `signal` aborts. */
function vocalsOf(assetId: string, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<AudioTrack> {
  const vocals = () => useStore.getState().assets[assetId]?.stems?.vocals;
  const have = vocals();
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const finish = (err?: Error) => {
      unsubscribe();
      signal.removeEventListener('abort', abort);
      const v = vocals();
      if (err) reject(err);
      else if (v) resolve(v);
      else reject(new Error('The vocals could not be separated.'));
    };
    const abort = () => { cancelStems(assetId); finish(new DOMException('Aligning was cancelled', 'AbortError')); };
    const unsubscribe = useStemState.subscribe((all) => {
      const st = all[assetId];
      if (st?.status === 'running') onProgress({ stage: 'separate', progress: st.progress });
      // A failure to save still leaves the stems on the song for this session.
      else if (st?.status === 'ready' || (st?.status === 'failed' && vocals())) finish();
      else if (st?.status === 'failed') finish(new Error(st.message));
      else if (st?.status === 'none') finish(new Error('The song was removed.'));
    });
    signal.addEventListener('abort', abort, { once: true });
    onProgress({ stage: 'separate', progress: 0 });
    separateStems(assetId);
  });
}

export function LyricAlignPanel({ assetId, track, text, lineCount, onDone, onClose }: {
  assetId: string | undefined; track: AudioTrack | undefined; text: string; lineCount: number;
  onDone: (result: AlignResult) => void; onClose: () => void;
}) {
  const [model, setModel] = useState<AlignModel>(savedModel);
  const [cached, setCached] = useState<Partial<Record<AlignModel, boolean>>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const stemsProblem = stemSupportProblem();
  const [listen, setListen] = useState<Listen>('mix');
  const separated = useStore((s) => !!(assetId && s.assets[assetId]?.stems));
  const [stemModelCached, setStemModelCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const unsupported = alignUnsupported();

  useEffect(() => {
    let live = true;
    void Promise.all(ALIGN_MODELS.map(async (m) => [m.id, await isModelCached(m.id)] as const))
      .then((r) => { if (live) setCached(Object.fromEntries(r)); });
    void isStemModelCached().then((c) => { if (live) setStemModelCached(c); });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const info = ALIGN_MODELS.find((m) => m.id === model)!;
  const start = async () => {
    if (!track || !assetId) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress({ stage: 'prepare' });
    try {
      const source = listen === 'vocals' ? await vocalsOf(assetId, setProgress, ctrl.signal) : track;
      const result = await alignToSong(source.buffer, text, model, setProgress, ctrl.signal);
      if (!ctrl.signal.aborted) onDone(result);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(alignErrorMessage(err));
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setProgress(null);
    }
  };
  const cancel = () => { abort.current?.abort(); setProgress(null); };

  // transformers.js learns file sizes as each download starts, so its total grows; the listed size is steadier.
  const total = progress?.stage === 'download' ? Math.max(progress.total, info.mb * 1e6) : 1;
  const pct = !progress ? 0
    : progress.stage === 'separate' ? progress.progress * 100
    : progress.stage === 'download' ? Math.min(100, (progress.loaded / total) * 100)
    : progress.stage === 'recognise' ? (progress.done / Math.max(1, progress.total)) * 100 : 0;
  const status = !progress ? ''
    : progress.stage === 'separate' ? `Separating the vocals · ${Math.round(progress.progress * 100)}%`
    : progress.stage === 'prepare' ? 'Preparing the song…'
    : progress.stage === 'download' ? `Downloading the speech model · ${(progress.loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB`
    : `Listening to the song · part ${Math.min(progress.total, progress.done + 1)} of ${progress.total} · ${progress.device === 'webgpu' ? 'on the GPU' : 'on the CPU'}`;

  return (
    <div className="lyric-align">
      <p>
        Listens to the song with a speech-recognition model (OpenAI Whisper) and times your {lineCount} line{lineCount === 1 ? '' : 's'} and
        their words. Your text stays exactly as written; only times are added. Words it could not hear clearly are underlined, so check
        the result before saving. Fast rap, heavy vocal effects and lyrics not in English time less well.
      </p>
      {unsupported ? <p className="warn">{unsupported}</p> : !track ? <p className="warn">Add your song first; alignment listens to it.</p> : (
        <>
          {!stemsProblem && <>
            <Select label="Listen to" value={listen} onChange={setListen} options={[
              ['mix', 'The whole song'],
              ['vocals', separated || stemModelCached ? 'The vocals only' : `The vocals only (separates the stems first, ${stemDownloadMB()} MB)`],
            ] as const} />
            {listen === 'vocals' && <p className="hint">
              Separates the vocals from the music first. On our test songs this timed a few songs better but more of them
              worse than the whole song, so try it when a result is poor.
            </p>}
          </>}
          <Select label="Model" value={model} onChange={(m) => { setModel(m); saveModel(m); }} options={ALIGN_MODELS.map((m) => [m.id, `${m.label} (${m.id}, ${cached[m.id] ? 'downloaded' : `${m.mb} MB`})`] as const)} />
          <p className="hint">
            {cached[model]
              ? 'This model is already in this browser.'
              : `The model downloads once from Hugging Face (about ${info.mb} MB) and stays in this browser’s cache.`}
            {' '}The song never leaves your device: recognition runs here, in the browser. It takes a while: on a fast computer about half
            the song’s length with Balanced, longer than the song with Accurate.
          </p>
          {progress && (
            <div className="progress" role="status">
              <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              <span>{status}</span>
            </div>
          )}
          {error && <p className="warn" role="alert">{error}</p>}
        </>
      )}
      <div className="buttons">
        {progress ? <button type="button" onClick={cancel}>Cancel</button> : <>
          <button type="button" className="primary" disabled={!track || !!unsupported} onClick={() => void start()}>
            {cached[model] ? 'Align' : `Download ${info.mb} MB and align`}
          </button>
          <button type="button" onClick={onClose}>Back</button>
        </>}
      </div>
    </div>
  );
}
