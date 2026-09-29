import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../cloud/account';
import {
  deleteDoc, duplicateDoc, listCloud, listLocal, moveToAccount, openDoc, renameDoc, useDoc, type LibraryItem, type Source,
} from '../cloud/documents';

const when = (iso: string) => {
  const d = new Date(iso), mins = (Date.now() - d.getTime()) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
};

/** The project library: projects in the account, and projects kept in this browser. */
export function ProjectsDialog({ onClose, onNew, onSignIn }: { onClose: () => void; onNew: () => void; onSignIn: () => void }) {
  const signedIn = useAccount((s) => s.status === 'signed-in');
  const current = useDoc((s) => s.ref);
  const [tab, setTab] = useState<Source>(signedIn ? 'cloud' : 'local');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setItems(await (tab === 'cloud' ? listCloud() : listLocal()));
    } catch (e) {
      setItems([]);
      setError((e as Error).message);
    }
  }, [tab]);
  useEffect(() => { setItems(null); if (tab === 'local' || signedIn) void load(); }, [tab, signedIn, load]);

  const act = async (item: LibraryItem, fn: () => Promise<unknown>, reload = true) => {
    setBusyId(item.id); setError('');
    try { await fn(); if (reload) await load(); } catch (e) { setError((e as Error).message); } finally { setBusyId(''); }
  };

  const open = (item: LibraryItem) => act(item, async () => { await openDoc(item.source, item.id); onClose(); }, false);

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal projects" role="dialog" aria-labelledby="projects-title">
        <div className="projects-head">
          <h3 id="projects-title">Projects</h3>
          <div className="tabs">
            <button className={tab === 'cloud' ? 'active' : ''} onClick={() => setTab('cloud')}>In your account</button>
            <button className={tab === 'local' ? 'active' : ''} onClick={() => setTab('local')}>On this device</button>
          </div>
          <span className="spacer" />
          <button className="primary" onClick={() => { onClose(); onNew(); }}>New project</button>
        </div>

        {tab === 'cloud' && !signedIn ? (
          <div className="empty-state">
            <p>Sign in to keep projects in your account and open them on any device.</p>
            <button className="primary" onClick={() => { onClose(); onSignIn(); }}>Sign in</button>
          </div>
        ) : items === null ? (
          <p className="hint">Loading…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p>{tab === 'cloud' ? 'No projects in your account yet.' : 'No projects saved in this browser.'}</p>
            <p className="hint">Projects save automatically while you edit.</p>
          </div>
        ) : (
          <ul className="project-grid">
            {items.map((item) => {
              const isOpen = current?.source === item.source && current.id === item.id;
              return (
                <li key={item.id} className={isOpen ? 'open' : ''} aria-busy={busyId === item.id}>
                  <button className="project-thumb" onClick={() => open(item)} title={`Open ${item.name}`}>
                    {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <span className="hint">No preview</span>}
                  </button>
                  <div className="project-meta">
                    <strong title={item.name}>{item.name}</strong>
                    <span className="hint">{isOpen ? 'Open now' : when(item.updatedAt)}</span>
                  </div>
                  <div className="project-actions">
                    <button className="sm" onClick={() => {
                      const name = prompt('Rename project', item.name)?.trim();
                      if (name && name !== item.name) void act(item, () => renameDoc(item, name));
                    }}>Rename</button>
                    <button className="sm" onClick={() => act(item, () => duplicateDoc(item))}>Duplicate</button>
                    {item.source === 'local' && signedIn && (
                      <button className="sm" title="Save to your account and remove from this browser" onClick={() => act(item, () => moveToAccount(item.id))}>Move to account</button>
                    )}
                    <button className="sm danger" onClick={() => {
                      if (confirm(`Delete "${item.name}"? This can't be undone.${isOpen ? ' It stays open, unsaved.' : ''}`)) void act(item, () => deleteDoc(item));
                    }}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="warn" role="alert">{error}</p>}
        <p className="hint">
          {tab === 'cloud'
            ? 'Your account stores layouts only. Songs, images, clips and fonts stay on each device; opening a project elsewhere asks for any that are missing.'
            : 'Projects here live only in this browser. Clearing site data removes them.'}
        </p>
        <div className="buttons end"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
