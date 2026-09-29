import { useEffect, useRef, useState } from 'react';
import { Compositor } from '../render/compositor';
import { loadPresets } from '../render/milkdrop';
import { useStore } from '../store';
import { ASPECTS, type Rect } from '../types';
import { currentTime, usePlayer } from './player';

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP = 0.012;

interface Drag { id: string; handle: Handle; start: Rect; px: number; py: number }

/** Snaps an edge/centre value to 0, 0.5 or 1 and reports which guide it hit. */
function snap(v: number, guides: number[]): [number, number | null] {
  for (const g of guides) if (Math.abs(v - g) < SNAP) return [g, g];
  return [v, null];
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const [area, setArea] = useState({ w: 640, h: 360 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [presetsReady, setPresetsReady] = useState(false);

  const aspect = useStore((s) => s.aspect);
  const selectedId = useStore((s) => s.selectedId);
  const layers = useStore((s) => s.project.layers);
  const A = ASPECTS[aspect];

  useEffect(() => { loadPresets().then(() => setPresetsReady(true)); }, []);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setArea({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);
  // Fit the frame inside the available area.
  const fit = Math.min(area.w / A.w, area.h / A.h);
  const box = { w: Math.max(1, Math.floor(A.w * fit)), h: Math.max(1, Math.floor(A.h * fit)) };

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.min(A.w, Math.round(box.w * dpr));
    canvas.height = Math.min(A.h, Math.round(box.h * dpr));
    compRef.current ??= new Compositor(canvas.getContext('2d', { alpha: false })!);
    const comp = compRef.current;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      const track = s.project.audioAssetId ? s.assets[s.project.audioAssetId]?.track ?? null : null;
      comp.render({ project: s.project, aspect: s.aspect, t: currentTime(), dt, track, assets: s.assets, preview: true, milkScale: 0.75, playing: usePlayer.getState().playing });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [box.w, box.h, A.w, A.h, presetsReady]);

  useEffect(() => () => compRef.current?.dispose(), []);

  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent, handle: Handle, id?: string) => {
    e.stopPropagation();
    const s = useStore.getState();
    const p = toFrac(e);
    let target = id;
    if (!target) {
      // Pick the top-most layer under the pointer, preferring anything smaller than the full frame.
      const hits = [...s.project.layers].reverse().filter((l) => {
        const r = l.rects[s.aspect];
        return l.visible && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      });
      const full = (l: (typeof hits)[number]) => { const r = l.rects[s.aspect]; return r.w >= 0.99 && r.h >= 0.99; };
      target = (hits.find((l) => !full(l)) ?? hits[0])?.id;
      s.select(target ?? null);
      if (!target) return;
    }
    const layer = s.project.layers.find((l) => l.id === target)!;
    (e.target as Element).setPointerCapture(e.pointerId);
    useStore.setState({ lastPush: 0 }); // each drag is its own undo step
    setDrag({ id: target, handle, start: layer.rects[s.aspect], px: p.x, py: p.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toFrac(e);
    const dx = p.x - drag.px, dy = p.y - drag.py;
    let { x, y, w, h } = drag.start;
    const hd = drag.handle;
    let gx: number | null = null, gy: number | null = null;
    if (hd === 'move') {
      x += dx; y += dy;
      if (!e.altKey) {
        let g: number | null;
        [x, g] = snap(x + w / 2, [0.5]); x -= w / 2; gx = g;
        if (gx === null) { [x, gx] = snap(x, [0]); if (gx === null) { [x, g] = snap(x + w, [1]); x -= w; gx = g; } }
        [y, g] = snap(y + h / 2, [0.5]); y -= h / 2; gy = g;
        if (gy === null) { [y, gy] = snap(y, [0]); if (gy === null) { [y, g] = snap(y + h, [1]); y -= h; gy = g; } }
      }
    } else {
      const min = 0.01;
      if (hd.includes('e')) w = Math.max(min, w + dx);
      if (hd.includes('s')) h = Math.max(min, h + dy);
      if (hd.includes('w')) { const nw = Math.max(min, w - dx); x += w - nw; w = nw; }
      if (hd.includes('n')) { const nh = Math.max(min, h - dy); y += h - nh; h = nh; }
      // Shift keeps the original proportions (in pixels) when dragging a corner.
      if (e.shiftKey && hd.length === 2) {
        const ratio = (drag.start.w * A.w) / (drag.start.h * A.h);
        const byW = (w * A.w) / ratio / A.h;
        if (hd.includes('n')) y += h - byW;
        h = byW;
      }
    }
    setGuides({ x: gx, y: gy });
    useStore.getState().setRect(drag.id, useStore.getState().aspect, { x, y, w, h });
  };

  const endDrag = () => { setDrag(null); setGuides({ x: null, y: null }); };

  const selected = layers.find((l) => l.id === selectedId);
  const sr = selected?.rects[aspect];

  return (
    <div className="stage-wrap" ref={wrapRef} onPointerDown={() => useStore.getState().select(null)}>
      <div
        className="stage"
        style={{ width: box.w, height: box.h }}
        onPointerDown={(e) => onPointerDown(e, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={canvasRef} style={{ width: box.w, height: box.h }} />
        {guides.x !== null && <div className="guide v" style={{ left: guides.x * box.w }} />}
        {guides.y !== null && <div className="guide h" style={{ top: guides.y * box.h }} />}
        {sr && (
          <div
            className="selection"
            style={{ left: sr.x * box.w, top: sr.y * box.h, width: sr.w * box.w, height: sr.h * box.h }}
            onPointerDown={(e) => onPointerDown(e, 'move', selected!.id)}
          >
            {HANDLES.map((hd) => (
              <div key={hd} className={`handle ${hd}`} onPointerDown={(e) => onPointerDown(e, hd, selected!.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
