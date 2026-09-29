import { useRef } from 'react';
import { useAccount } from '../cloud/account';
import { refreshMissing, resolveConflict, useDoc } from '../cloud/documents';
import { KIND_LABEL, remapAsset, type MediaRef } from '../cloud/media';
import { useStore } from '../store';

/** A short save indicator next to the project name. */
export function SaveStatus() {
  const { status, ref } = useDoc();
  const where = ref?.source === 'cloud' ? 'your account' : 'this device';
  const [text, cls, title] = {
    idle: ['', '', ''],
    saving: ['Saving…', 'pending', ''],
    saved: [ref?.source === 'cloud' ? 'Saved' : 'Saved locally', 'ok', `Saved to ${where}`],
    'waiting-sign-in': ['Not synced', 'warn', 'Sign in to save to your account'],
    offline: ['Offline', 'warn', 'Changes are kept in this browser and save when you reconnect'],
    conflict: ['Conflict', 'bad', 'Saved elsewhere since you opened it'],
    error: ['Not saved', 'bad', useDoc.getState().message],
  }[status] as [string, string, string];
  if (!text) return null;
  return <span className={`save-status ${cls}`} title={title} role="status">{text}</span>;
}

/** Notices above the stage: conflicts, files missing on this device, offline and signed-out saving. */
export function DocBar({ onSignIn }: { onSignIn: () => void }) {
  const { status, message, missing } = useDoc();
  const signedIn = useAccount((s) => s.status === 'signed-in');
  return (
    <>
      {status === 'conflict' && (
        <div className="doc-bar bad" role="alert">
          <span>{message}</span>
          <button className="sm" onClick={() => void resolveConflict('reload')}>Load the saved version</button>
          <button className="sm primary" onClick={() => void resolveConflict('copy')}>Keep mine as a copy</button>
        </div>
      )}
      {(status === 'offline' || status === 'error') && <div className="doc-bar warn" role="status"><span>{message}</span></div>}
      {status === 'waiting-sign-in' && !signedIn && (
        <div className="doc-bar warn" role="status">
          <span>{message}</span>
          <button className="sm primary" onClick={onSignIn}>Sign in</button>
        </div>
      )}
      {missing.length > 0 && <MissingFiles missing={missing} />}
    </>
  );
}

/** Files this project uses that aren't on this device, each with a button to choose it. */
function MissingFiles({ missing }: { missing: MediaRef[] }) {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<MediaRef | null>(null);
  const pick = (m: MediaRef) => { target.current = m; input.current?.click(); };
  return (
    <div className="doc-bar missing" role="status">
      <span>{missing.length === 1 ? 'A file this project uses isn’t on this device:' : `${missing.length} files this project uses aren’t on this device:`}</span>
      {missing.slice(0, 4).map((m) => (
        <button key={m.id} className="sm" title={`Choose ${m.name}`} onClick={() => pick(m)}>
          {KIND_LABEL[m.kind]}: {m.name}
        </button>
      ))}
      {missing.length > 4 && <span className="hint">and {missing.length - 4} more</span>}
      <input ref={input} type="file" hidden onChange={async (e) => {
        const file = e.target.files?.[0];
        const m = target.current;
        e.target.value = '';
        if (!file || !m) return;
        const [asset] = await useStore.getState().importFiles([file]);
        if (!asset) return;
        useStore.getState().change((p) => remapAsset(p, m.id, asset.meta.id));
        refreshMissing();
      }} />
    </div>
  );
}
