import { useEffect, useRef, useState } from 'react';
import { fontFamily, loadStoredAssets, type RuntimeAsset } from './assets';
import { LOGO_RECTS, videoBackgroundIndex } from './defaults';
import { hasSavedProject, useStore } from './store';
import { ASPECTS, ASPECT_IDS, type Project } from './types';
import { ExportDialog } from './ui/ExportDialog';
import { Inspector } from './ui/Inspector';
import { LayerPanel } from './ui/LayerPanel';
import { Stage } from './ui/Stage';
import { TemplateGallery } from './ui/TemplateGallery';
import { Menu } from './ui/Menu';
import { AboutDialog } from './ui/AboutDialog';
import { AccountButton } from './ui/AccountButton';
import { AccountDialog, type AccountTab } from './ui/AccountDialog';
import { AuthDialog, type AuthMode } from './ui/AuthDialog';
import { DocBar, SaveStatus } from './ui/DocBar';
import { ProjectsDialog } from './ui/ProjectsDialog';
import { RendersDialog } from './ui/RendersDialog';
import { useRenders } from './cloud/renders';
import { useAccount } from './cloud/account';
import { applyDefaults } from './cloud/defaults';
import { newDoc, refreshMissing } from './cloud/documents';
import { BrandLogo, PatreonButton, SocialLinks } from './ui/Brand';
import { BRAND, visibleLink } from './brand';
import { audioEl, currentTime, fmtTime, usePlayer } from './ui/player';

/** Puts freshly imported files to work: songs become the soundtrack, images and lyrics fill or create layers. */
function placeAssets(list: RuntimeAsset[]) {
  const s = useStore.getState();
  for (const a of list) {
    const layers = useStore.getState().project.layers;
    if (a.meta.kind === 'audio') {
      s.change((p) => ({ ...p, audioAssetId: a.meta.id }));
    } else if (a.meta.kind === 'image') {
      const sel = layers.find((l) => l.id === s.selectedId);
      const target = sel?.type === 'image' && !sel.props.assetId ? sel : layers.find((l) => l.type === 'image' && !l.props.assetId);
      if (target) { s.updateProps(target.id, { assetId: a.meta.id }); s.select(target.id); }
      else {
        const id = s.addLayer('image', { assetId: a.meta.id, fit: 'contain', shadow: 0, radius: 0 });
        if (layers.some((l) => l.type === 'image')) {
          s.updateLayer(id, { name: 'Logo' });
          for (const asp of ASPECT_IDS) s.setRect(id, asp, LOGO_RECTS[asp]);
        }
      }
    } else if (a.meta.kind === 'video') {
      const sel = layers.find((l) => l.id === s.selectedId);
      const target = sel?.type === 'video' ? sel : layers.find((l) => l.type === 'video' && !l.props.assetId);
      if (target) { s.updateProps(target.id, { assetId: a.meta.id, offset: 0 }); s.select(target.id); }
      else s.addLayer('video', { assetId: a.meta.id }, videoBackgroundIndex(layers));
    } else if (a.meta.kind === 'font') {
      // Apply to the selected text-like layer; otherwise the font just joins the library and the font menus.
      const sel = layers.find((l) => l.id === s.selectedId);
      if (sel && 'font' in sel.props) s.updateProps(sel.id, { font: fontFamily(a.meta.id) });
    } else {
      const target = layers.find((l) => l.type === 'lyrics' && !l.props.assetId);
      if (target) { s.updateProps(target.id, { assetId: a.meta.id }); s.select(target.id); }
      else s.addLayer('lyrics', { assetId: a.meta.id });
    }
  }
}

/** "Landscape 16:9" with the name dropped on phones, where only the ratio fits. */
function AspectLabel({ label }: { label: string }) {
  const i = label.lastIndexOf(' ');
  // One wrapper, because buttons are flex containers and would put a gap between the parts.
  return <span><span className="aspect-name">{label.slice(0, i)} </span>{label.slice(i + 1)}</span>;
}

/** A curved arrow drawn with a thick stroke, so undo and redo read clearly at header size. */
function HistoryIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={redo ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

type Dialog =
  | { kind: 'export' | 'gallery' | 'about' | 'projects' | 'renders' }
  | { kind: 'auth'; mode: AuthMode; token?: string }
  | { kind: 'account'; tab: AccountTab };

/** Readable messages for the error codes Better Auth adds to redirect URLs. */
const AUTH_ERRORS: Record<string, string> = {
  INVALID_TOKEN: 'That link has expired or was already used. Request a new one.',
  TOKEN_EXPIRED: 'That link has expired. Request a new one.',
  account_already_linked_to_different_user: `That account is already connected to a different ${BRAND.name} account.`,
  email_not_found: 'The provider didn’t share an email address, so the account couldn’t be created.',
  access_denied: 'Sign-in was cancelled.',
};

function Transport() {
  const { playing, toggle, seek, loop, setLoop } = usePlayer();
  const audioId = useStore((s) => s.project.audioAssetId);
  const track = useStore((s) => (audioId ? s.assets[audioId]?.track : undefined));
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(currentTime()), 100);
    return () => clearInterval(id);
  }, []);
  const dur = track?.duration ?? 0;
  return (
    <div className="transport">
      <button className="play primary" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
      <span className="time">{fmtTime(t)}</span>
      <input type="range" min={0} max={dur || 1} step={0.01} value={Math.min(t, dur || 1)} disabled={!dur} onChange={(e) => seek(Number(e.target.value))} />
      <span className="time">{fmtTime(dur)}</span>
      <label className="loop"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
    </div>
  );
}

export default function App() {
  const project = useStore((s) => s.project);
  const aspect = useStore((s) => s.aspect);
  const assets = useStore((s) => s.assets);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const { setAspect, undo, redo, importFiles, registerAssets, change } = useStore.getState();
  const signedIn = useAccount((s) => s.status === 'signed-in');
  const [dialog, setDialog] = useState<Dialog | null>(() => (hasSavedProject() ? null : { kind: 'gallery' }));
  const [toast, setToast] = useState('');
  const close = () => setDialog(null);
  const [dragOver, setDragOver] = useState(false);
  // Which panel shows on narrow screens. Picking a layer opens its settings.
  const [panel, setPanel] = useState<'layers' | 'inspector'>('layers');
  const selectedId = useStore((s) => s.selectedId);
  useEffect(() => { if (selectedId) setPanel('inspector'); }, [selectedId]);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  useEffect(() => { loadStoredAssets().then((list) => { registerAssets(list); refreshMissing(); }); }, [registerAssets]);

  // Account state, and the links that bring people back from email and OAuth.
  useEffect(() => {
    void useAccount.getState().refresh();
    const q = new URLSearchParams(location.search);
    const token = q.get('token'), error = q.get('error');
    if (token) setDialog({ kind: 'auth', mode: 'reset', token });
    else if (error) setToast(AUTH_ERRORS[error] ?? `Sign-in didn't complete (${error.toLowerCase().replace(/_/g, ' ')}).`);
    else if (q.has('verified')) setToast('Email confirmed. You’re signed in.');
    else if (q.get('account') === 'connections') setDialog({ kind: 'account', tab: 'connections' });
    // Keep only the theme choice in the address bar.
    const theme = q.get('theme');
    if ([...q.keys()].some((k) => k !== 'theme')) history.replaceState(null, '', theme ? `/?theme=${theme}` : '/');
  }, []);
  // Cloud renders: resume following active ones after sign-in, and say when one finishes.
  useEffect(() => {
    useRenders.setState({
      onFinished: (j) => setToast(j.status === 'done' ? `Cloud render ready: ${j.name}. Open Renders to download.` : `Cloud render failed: ${j.name}.`),
    });
  }, []);
  useEffect(() => { if (signedIn) void useRenders.getState().refresh().catch(() => {}); }, [signedIn]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 6000); return () => clearTimeout(t); }, [toast]);

  // Keep the player pointed at the project's song.
  const audioUrl = project.audioAssetId ? assets[project.audioAssetId]?.url ?? null : null;
  useEffect(() => { usePlayer.getState().setSource(audioUrl); }, [audioUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'd' && s.selectedId) { e.preventDefault(); s.duplicateLayer(s.selectedId); }
      else if (e.key === ' ') { e.preventDefault(); usePlayer.getState().toggle(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) s.removeLayer(s.selectedId);
      else if (e.key === 'Escape') s.select(null);
      else if (e.key.startsWith('Arrow') && s.selectedId) {
        e.preventDefault();
        const l = s.project.layers.find((x) => x.id === s.selectedId)!;
        const r = l.rects[s.aspect], A = ASPECTS[s.aspect], step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.setRect(l.id, s.aspect, { ...r, x: r.x + dx / A.w, y: r.y + dy / A.h });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onFiles = async (files: File[]) => { placeAssets(await importFiles(files)); refreshMissing(); };

  const saveProject = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
    a.download = `${project.name || 'project'}.undertow.json`;
    a.click();
  };

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`} data-panel={panel}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles([...e.dataTransfer.files]); }}
    >
      <header>
        <button className="ghost brand-button" onClick={() => setDialog({ kind: 'about' })} aria-label={`About ${BRAND.name}`}><BrandLogo /></button>
        <label className="project-field" title="Project name">
          <span className="pencil" aria-hidden="true">✎</span>
          <input className="project-name" aria-label="Project name" placeholder="Project name" value={project.name}
            onChange={(e) => change((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <SaveStatus />
        <div className="tabs">
          {ASPECT_IDS.map((a) => (
            <button key={a} className={a === aspect ? 'active' : ''} onClick={() => setAspect(a)} aria-label={ASPECTS[a].label}>
              <AspectLabel label={ASPECTS[a].label} />
            </button>
          ))}
        </div>
        <div className="spacer" />
        {/* Starts the header's second row on phones. */}
        <span className="row-break" aria-hidden="true" />
        <button className="icon history" onClick={undo} disabled={!past} title="Undo (⌘Z)" aria-label="Undo"><HistoryIcon /></button>
        <button className="icon history" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)" aria-label="Redo"><HistoryIcon redo /></button>
        <span className="divider" />
        <button className="wide-only" onClick={() => fileInput.current?.click()}>Add files…</button>
        <input ref={fileInput} type="file" multiple hidden accept="audio/*,image/*,video/*,.svg,.lrc,.srt,.vtt,.mov,.webm,.ttf,.otf,.woff,.woff2"
          onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <Menu label={<><span className="menu-icon" aria-hidden="true">☰</span><span className="label">Project</span></>}>
          {/* On narrow screens the header drops "Add files…" and Support; they live here instead. */}
          <button className="narrow-only" onClick={() => fileInput.current?.click()}>Add files…</button>
          <button onClick={() => setDialog({ kind: 'projects' })}>Projects…</button>
          <button onClick={() => setDialog({ kind: 'gallery' })}>New from template…</button>
          <button onClick={() => change((p) => applyDefaults(p, useAccount.getState().defaults))}>Apply my defaults</button>
          {!signedIn && <button onClick={() => setDialog({ kind: 'account', tab: 'defaults' })}>Edit defaults…</button>}
          <button onClick={saveProject}>Download layout (.json)</button>
          <button onClick={() => projectInput.current?.click()}>Import layout (.json)…</button>
          {visibleLink(BRAND.patreon) && <a className="btn narrow-only" href={BRAND.patreon} target="_blank" rel="noopener noreferrer">Support on Patreon</a>}
        </Menu>
        <input ref={projectInput} type="file" hidden accept=".json" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try { newDoc(JSON.parse(await f.text()) as Project); } catch { alert(`That file is not an ${BRAND.name} layout.`); }
          }
          e.target.value = '';
        }} />
        <button className="primary" onClick={() => { audioEl.pause(); setDialog({ kind: 'export' }); }}>Export</button>
        <span className="divider wide-only" />
        <div className="header-socials"><SocialLinks /></div>
        <span className="wide-only"><PatreonButton label="Support" small /></span>
        <AccountButton onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })}
          onAccount={(tab) => setDialog({ kind: 'account', tab })} onProjects={() => setDialog({ kind: 'projects' })}
          onRenders={() => setDialog({ kind: 'renders' })} />
      </header>
      {/* Narrow screens stack the panels under the stage and show one at a time. */}
      <div className="panel-switch tabs" role="tablist" aria-label="Panels">
        <button role="tab" aria-selected={panel === 'layers'} className={panel === 'layers' ? 'active' : ''} onClick={() => setPanel('layers')}>Layers</button>
        <button role="tab" aria-selected={panel === 'inspector'} className={panel === 'inspector' ? 'active' : ''} onClick={() => setPanel('inspector')}>Edit</button>
      </div>
      <LayerPanel />
      <main>
        <DocBar onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })} />
        <Stage />
        <Transport />
      </main>
      <Inspector />
      {dialog?.kind === 'export' && <ExportDialog onClose={close} onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })} />}
      {dialog?.kind === 'renders' && <RendersDialog onClose={close} />}
      {dialog?.kind === 'gallery' && <TemplateGallery onClose={close} />}
      {dialog?.kind === 'about' && <AboutDialog onClose={close} />}
      {dialog?.kind === 'auth' && <AuthDialog initial={dialog.mode} resetToken={dialog.token} onClose={close} />}
      {dialog?.kind === 'account' && <AccountDialog initialTab={dialog.tab} onClose={close} />}
      {dialog?.kind === 'projects' && (
        <ProjectsDialog onClose={close} onNew={() => setDialog({ kind: 'gallery' })} onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })} />
      )}
      {toast && <div className="toast" role="status" onClick={() => setToast('')}>{toast}</div>}
      {dragOver && <div className="drop-hint">Drop songs, images, video clips, fonts or lyric files</div>}
    </div>
  );
}
