import { useEffect, useRef, useState } from 'react';
import type { AudioTrack } from '../audio/analysis';
import type { AlignResult } from '../audio/lyricAlign';
import {
  ALIGN_MODELS, alignErrorMessage, alignToSong, alignUnsupported, DEFAULT_ALIGN_MODEL, isModelCached,
  type AlignModel, type AlignProgress,
} from '../audio/lyricAlignClient';
import { Select } from './controls';

/**
 * The "Align automatically" step of the lyric timing editor: picks a speech
 * model, says what it downloads, and runs alignment with progress and cancel.
 * The result goes back to the editor for review.
 */
export function LyricAlignPanel({ track, text, lineCount, onDone, onClose }: {
  track: AudioTrack | undefined; text: string; lineCount: number;
  onDone: (result: AlignResult) => void; onClose: () => void;
}) {
  const [model, setModel] = useState<AlignModel>(DEFAULT_ALIGN_MODEL);
  const [cached, setCached] = useState<Partial<Record<AlignModel, boolean>>>({});
  const [progress, setProgress] = useState<AlignProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const unsupported = alignUnsupported();

  useEffect(() => {
    let live = true;
    void Promise.all(ALIGN_MODELS.map(async (m) => [m.id, await isModelCached(m.id)] as const))
      .then((r) => { if (live) setCached(Object.fromEntries(r)); });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const info = ALIGN_MODELS.find((m) => m.id === model)!;
  const start = async () => {
    if (!track) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress({ stage: 'prepare' });
    try {
      const result = await alignToSong(track.buffer, text, model, setProgress, ctrl.signal);
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
    : progress.stage === 'download' ? Math.min(100, (progress.loaded / total) * 100)
    : progress.stage === 'recognise' ? (progress.done / Math.max(1, progress.total)) * 100 : 0;
  const status = !progress ? ''
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
          <Select label="Model" value={model} onChange={setModel} options={ALIGN_MODELS.map((m) => [m.id, `${m.label} (${m.id}, ${cached[m.id] ? 'downloaded' : `${m.mb} MB`})`] as const)} />
          <p className="hint">
            {cached[model]
              ? 'This model is already in this browser.'
              : `The model downloads once from Hugging Face (about ${info.mb} MB) and stays in this browser’s cache.`}
            {' '}The song never leaves your device: recognition runs here, in the browser. It takes a while, roughly as long as the song or
            more on the CPU.
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
