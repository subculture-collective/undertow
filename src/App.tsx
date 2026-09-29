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
      <button className="play" onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
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
  const { setAspect, undo, redo, importFiles, registerAssets, change, replaceProject } = useStore.getState();
  const [exporting, setExporting] = useState(false);
  const [gallery, setGallery] = useState(() => !hasSavedProject());
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  useEffect(() => { loadStoredAssets().then(registerAssets); }, [registerAssets]);

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

  const onFiles = async (files: File[]) => placeAssets(await importFiles(files));

  const saveProject = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
    a.download = `${project.name || 'project'}.vizstudio.json`;
    a.click();
  };

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles([...e.dataTransfer.files]); }}
    >
      <header>
        <strong className="logo">vizstudio</strong>
        <input className="project-name" value={project.name} onChange={(e) => change((p) => ({ ...p, name: e.target.value }))} />
        <div className="tabs">
          {ASPECT_IDS.map((a) => (
            <button key={a} className={a === aspect ? 'active' : ''} onClick={() => setAspect(a)}>{ASPECTS[a].label}</button>
          ))}
        </div>
        <div className="spacer" />
        <button onClick={undo} disabled={!past} title="Undo (⌘Z)">↶</button>
        <button onClick={redo} disabled={!future} title="Redo (⇧⌘Z)">↷</button>
        <button onClick={() => fileInput.current?.click()}>Add files…</button>
        <input ref={fileInput} type="file" multiple hidden accept="audio/*,image/*,video/*,.svg,.lrc,.srt,.vtt,.mov,.webm,.ttf,.otf,.woff,.woff2"
          onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <details className="menu">
          <summary>Project</summary>
          <div>
            <button onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); setGallery(true); }}>New from template…</button>
            <button onClick={saveProject}>Save layout (.json)</button>
            <button onClick={() => projectInput.current?.click()}>Open layout…</button>
          </div>
        </details>
        <input ref={projectInput} type="file" hidden accept=".json" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try { replaceProject(JSON.parse(await f.text()) as Project); } catch { alert('That file is not a vizstudio layout.'); }
          }
          e.target.value = '';
        }} />
        <button className="primary" onClick={() => { audioEl.pause(); setExporting(true); }}>Export</button>
      </header>
      <LayerPanel />
      <main>
        <Stage />
        <Transport />
      </main>
      <Inspector />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {gallery && <TemplateGallery onClose={() => setGallery(false)} />}
      {dragOver && <div className="drop-hint">Drop songs, images, video clips, fonts or lyric files</div>}
    </div>
  );
}
