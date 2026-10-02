import { useEffect, useState } from 'react';
import { useAccount } from '../cloud/account';
import { isActive, outputUrl, removeRender, useRenders, type RenderJob } from '../cloud/renders';
import { Modal } from './Modal';
import { confirmAsk } from './ask';

const STATUS: Record<RenderJob['status'], string> = {
  awaiting_upload: 'Uploading files', queued: 'Waiting for a renderer', running: 'Rendering',
  done: 'Ready', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired',
};

const ASPECT_LABEL = { landscape: '16:9', portrait: '9:16', square: '1:1' } as const;

export function RenderRow({ job }: { job: RenderJob }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const o = job.options;
  const act = async () => {
    const active = isActive(job);
    const ok = await confirmAsk(active
      ? { title: 'Cancel this render?', body: 'Its minutes are refunded.', action: 'Cancel render', danger: true }
      : { title: 'Delete this render?', body: 'Its video is deleted too.', action: 'Delete render', danger: true });
    if (!ok) return;
    setBusy(true); setError('');
    try { await removeRender(job.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className={`render-row ${job.status}`}>
      <div className="render-meta">
        <strong>{job.name}</strong>
        <span className="hint">
          {ASPECT_LABEL[o.aspect]} · {o.shortSide === 2160 ? '4K' : `${o.shortSide}p`} · {o.fps} fps · {Math.round(job.durationSeconds)} s
          {job.expiresAt && job.status === 'done' ? ` · kept until ${new Date(job.expiresAt).toLocaleDateString()}` : ''}
        </span>
      </div>
      <div className="render-state">
        {job.status === 'running' ? (
          <div className="progress"><div className="bar"><div style={{ width: `${job.progress}%` }} /></div></div>
        ) : null}
        <span className={job.status === 'failed' ? 'warn' : 'hint'} title={job.error ?? undefined}>
          {STATUS[job.status]}{job.status === 'running' ? ` ${job.progress}%` : ''}{job.status === 'failed' && job.error ? `: ${job.error}` : ''}
        </span>
      </div>
      <div className="buttons">
        {job.status === 'done' && (
          <a className="btn sm primary" href={outputUrl(job.id)} download>
            Download{job.outputBytes ? ` (${(job.outputBytes / 1e6).toFixed(1)} MB)` : ''}
          </a>
        )}
        {job.status !== 'expired' && job.status !== 'cancelled' && (
          <button className="sm" disabled={busy} onClick={act}>{isActive(job) ? 'Cancel' : 'Delete'}</button>
        )}
      </div>
      {error && <p className="warn">{error}</p>}
    </li>
  );
}

/** Recent cloud renders with progress, downloads and cancel. */
export function RendersDialog({ onClose }: { onClose: () => void }) {
  const jobs = useRenders((s) => s.jobs);
  const refresh = useRenders((s) => s.refresh);
  const retentionDays = useAccount((s) => s.renderOutputDays);
  const [error, setError] = useState('');
  useEffect(() => { refresh().catch((e) => setError((e as Error).message)); }, [refresh]);
  return (
    <Modal className="renders" labelledBy="renders-title" onClose={onClose}>
      <h3 id="renders-title">Cloud renders</h3>
      {jobs.length === 0
        ? <p className="hint">No cloud renders yet. Choose “In the cloud” when exporting.</p>
        : <ul className="render-list">{jobs.map((j) => <RenderRow key={j.id} job={j} />)}</ul>}
      {error && <p className="warn">{error}</p>}
      <p className="hint">Renders keep going after you close this. Files you upload for a render are deleted when it finishes; the video is kept for {retentionDays} days.</p>
      <div className="buttons end"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
