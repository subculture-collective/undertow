import { useEffect, useState } from 'react';
import type { RuntimeAsset } from '../assets';
import { demoTrack } from '../audio/demo';
import type { AudioTrack } from '../audio/analysis';
import { ClipReader } from '../export/clipReader';
import { Compositor, type DecodedFrame } from '../render/compositor';
import { loadPresets } from '../render/milkdrop';
import { useAccount } from '../cloud/account';
import { applyDefaults } from '../cloud/defaults';
import { newDoc } from '../cloud/documents';
import { useStore } from '../store';
import { applyTemplate, TEMPLATES, type Template } from '../templates';
import { ASPECTS, type AspectId, type Project } from '../types';
import { Modal } from './Modal';

let demo: AudioTrack | null = null;

/** Stand-ins for missing artwork, lyrics and clips, so thumbnails show the design rather than empty boxes. */
let standIns: Promise<{ cover: RuntimeAsset; lyrics: RuntimeAsset; frame: HTMLCanvasElement }> | null = null;
function getStandIns() {
  standIns ??= (async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 512, 512);
    bg.addColorStop(0, '#2b1055'); bg.addColorStop(1, '#ff6a5e');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
    for (let i = 6; i > 0; i--) {
      g.fillStyle = `rgba(255, 220, 180, ${0.06 * i})`;
      g.beginPath(); g.arc(330, 190, i * 28, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#12091f';
    g.fillRect(0, 380, 512, 132);
    const img = new Image();
    img.src = c.toDataURL();
    await img.decode();
    const meta = (kind: 'image' | 'lyrics') => ({ id: `demo-${kind}`, kind, name: 'demo', mime: '' });
    const cover: RuntimeAsset = { meta: meta('image'), blob: new Blob(), url: img.src, image: img };
    const lyrics: RuntimeAsset = {
      meta: meta('lyrics'), blob: new Blob(), url: '', cues: [{ start: 0.5, end: 4, text: 'Your lyrics light up here' }],
    };
    const frame = document.createElement('canvas');
    frame.width = 640; frame.height = 360;
    const f = frame.getContext('2d')!;
    const sky = f.createLinearGradient(0, 0, 0, 360);
    sky.addColorStop(0, '#0d1b3d'); sky.addColorStop(0.6, '#5a3a78'); sky.addColorStop(1, '#f08a5d');
    f.fillStyle = sky; f.fillRect(0, 0, 640, 360);
    f.fillStyle = '#0a0a14';
    f.beginPath(); f.moveTo(0, 360);
    for (let x = 0; x <= 640; x += 40) f.lineTo(x, 270 - Math.abs(Math.sin(x * 0.013)) * 70 - (x % 80) * 0.3);
    f.lineTo(640, 360); f.fill();
    return { cover, lyrics, frame };
  })();
  return standIns;
}

async function renderThumb(project: Project, aspect: AspectId, assets: Record<string, RuntimeAsset>): Promise<string> {
  const A = ASPECTS[aspect], k = 480 / Math.max(A.w, A.h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A.w * k); canvas.height = Math.round(A.h * k);
  const comp = new Compositor(canvas.getContext('2d', { alpha: false })!);
  const s = await getStandIns();
  const all = { ...assets, [s.cover.meta.id]: s.cover, [s.lyrics.meta.id]: s.lyrics };
  const videoFrames = new Map<string, DecodedFrame | null>();
  for (const l of project.layers) {
    if (l.type === 'image' && !l.props.assetId) l.props.assetId = s.cover.meta.id;
    if (l.type === 'lyrics' && !l.props.assetId) l.props.assetId = s.lyrics.meta.id;
    if (l.type !== 'video') continue;
    const clip = assets[l.props.assetId ?? ''];
    let frame: DecodedFrame | null = s.frame;
    if (clip?.video) {
      // A one-off read of the first frame; if the browser can't decode it the stand-in is shown instead.
      const reader = await ClipReader.open(clip.blob, clip.meta.name, canvas.width).catch(() => null);
      frame = (await reader?.frameAt(0).catch(() => null)) ?? s.frame;
      if (frame !== s.frame) {
        const copy = document.createElement('canvas');
        copy.width = frame.width; copy.height = frame.height;
        copy.getContext('2d')!.drawImage(frame, 0, 0);
        frame = copy;
      }
      await reader?.close();
    }
    videoFrames.set(l.id, frame);
  }
  demo ??= demoTrack();
  // Run a second of frames so smoothed meters and Milkdrop settle, ending just after a kick.
  const fps = 30;
  for (let i = 0; i <= fps; i++) {
    comp.render({ project, aspect, t: 1.03 + i / fps, dt: 1 / fps, track: demo, assets: all, preview: false, videoFrames });
  }
  comp.dispose();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** A template filled with the current song and artwork, plus the account's defaults when they apply to new projects. */
function build(t: Template, current: Project, assets: Record<string, RuntimeAsset>) {
  const p = applyTemplate(t, current, assets);
  const d = useAccount.getState().defaults;
  return d.applyToNewProjects ? applyDefaults(p, d) : p;
}

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.aspect);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadPresets();
      for (const t of TEMPLATES) {
        if (cancelled) return;
        const { project, assets } = useStore.getState();
        try {
          const url = await renderThumb(build(t, project, assets), aspect, assets);
          if (!cancelled) setThumbs((m) => ({ ...m, [t.id]: url }));
        } catch (e) {
          console.warn('template thumbnail failed', t.id, e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [aspect]);

  const choose = (t: Template) => {
    const { project, assets } = useStore.getState();
    // A new project gets its own name; the current one stays in the library under its name.
    newDoc({ ...build(t, project, assets), name: 'Untitled' });
    onClose();
  };

  return (
    <Modal className="gallery" labelledBy="gallery-title" onClose={onClose}>
      <h3 id="gallery-title">Start from a template</h3>
      <p className="hint">
        Starts a new project with your song, artwork, clip and lyrics, plus your defaults. The current project stays in Projects.
        Previews show {ASPECTS[aspect].label}.
      </p>
      <div className="gallery-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="template-card" onClick={() => choose(t)}>
            <div className={`thumb ${aspect}`}>
              {thumbs[t.id] ? <img src={thumbs[t.id]} alt="" /> : <span className="hint">Rendering…</span>}
            </div>
            <strong>{t.name}</strong>
            <span className="hint">{t.description}</span>
          </button>
        ))}
      </div>
      <div className="buttons end"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
