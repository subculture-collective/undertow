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
import { AskHost, noticeAsk } from './ui/ask';
import { Icon } from './ui/icons';
import { Scrubber } from './ui/Scrubber';

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

/** Playback controls. Until the project has a song, adding one is the main action here. */
function Transport({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { playing, toggle, seek, loop, setLoop } = usePlayer();
  const audioId = useStore((s) => s.project.audioAssetId);
  const track = useStore((s) => (audioId ? s.assets[audioId]?.track : undefined));
  const songInput = useRef<HTMLInputElement>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(currentTime()), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="transport">
      <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
      {audioId ? (
        <>
          <span className="time">{fmtTime(t)}</span>
          <Scrubber track={track} time={t} onSeek={seek} />
          <span className="time">{fmtTime(track?.duration ?? 0)}</span>
          <label className="loop"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
        </>
      ) : (
        <>
          <button className="primary" onClick={() => songInput.current?.click()}>Add your song</button>
          <input ref={songInput} type="file" hidden accept="audio/*"
            onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <p className="hint add-song-hint">Or drop it anywhere. Until then the layers have nothing to react to, and exports are silent and 15 seconds long.</p>
        </>
      )}
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
    else if (q.get('account') === 'billing') setDialog({ kind: 'account', tab: 'billing' });
    // Remove consumed account parameters and obsolete theme links.
    if (q.size) history.replaceState(null, '', '/');
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
      // Typing belongs to the field, and an open dialog owns every key.
      if (el.closest('input, textarea, select, [role="listbox"]') || document.querySelector('dialog[open]')) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'd' && s.selectedId) { e.preventDefault(); s.duplicateLayer(s.selectedId); }
      else if (e.key === 'Escape') s.select(null);
      // A focused button, link or menu keeps Space, Delete and the arrows for itself. Layer rows are the
      // exception for Delete and the arrows, which act on the layer just picked.
      else if (el.closest('button, a, summary') && (e.key === ' ' || !el.closest('.layer-list'))) return;
      else if (e.key === ' ') { e.preventDefault(); usePlayer.getState().toggle(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) s.removeLayer(s.selectedId);
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
          <span className="pencil"><Icon name="pencil" size={12} /></span>
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
        <button className="icon history" onClick={undo} disabled={!past} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" size={18} /></button>
        <button className="icon history" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" size={18} /></button>
        <span className="divider" />
        <button className="wide-only" onClick={() => fileInput.current?.click()}>Add files…</button>
        <input ref={fileInput} type="file" multiple hidden accept="audio/*,image/*,video/*,.svg,.lrc,.srt,.vtt,.mov,.webm,.ttf,.otf,.woff,.woff2"
          onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <Menu label={<><span className="menu-icon"><Icon name="menu" /></span><span className="label">Project</span></>}>
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
            try { newDoc(JSON.parse(await f.text()) as Project); }
            catch { void noticeAsk({ title: 'That file didn’t open', body: `It isn’t an ${BRAND.name} layout. Layouts are the .json files from “Download layout”.` }); }
          }
          e.target.value = '';
        }} />
        {/* The view's main action once there is a song; until then that is "Add your song" in the transport. */}
        <button className={project.audioAssetId ? 'primary' : ''} onClick={() => { audioEl.pause(); setDialog({ kind: 'export' }); }}>Export</button>
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
        <Transport onFiles={(files) => void onFiles(files)} />
      </main>
      <Inspector />
      {dialog?.kind === 'export' && <ExportDialog onClose={close} onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })} onBilling={() => setDialog({ kind: 'account', tab: 'billing' })} />}
      {dialog?.kind === 'renders' && <RendersDialog onClose={close} />}
      {dialog?.kind === 'gallery' && <TemplateGallery onClose={close} />}
      {dialog?.kind === 'about' && <AboutDialog onClose={close} />}
      {dialog?.kind === 'auth' && <AuthDialog initial={dialog.mode} resetToken={dialog.token} onClose={close} />}
      {dialog?.kind === 'account' && <AccountDialog initialTab={dialog.tab} onClose={close} />}
      {dialog?.kind === 'projects' && (
        <ProjectsDialog onClose={close} onNew={() => setDialog({ kind: 'gallery' })} onSignIn={() => setDialog({ kind: 'auth', mode: 'sign-in' })} />
      )}
      <AskHost />
      {toast && <div className="toast" role="status" onClick={() => setToast('')}>{toast}</div>}
      {dragOver && <div className="drop-hint">Drop songs, images, video clips, fonts or lyric files</div>}
    </div>
  );
}
