import { create } from 'zustand';
import { deleteStoredAsset, importFile, type RuntimeAsset } from './assets';
import { createLayer, starterProject, uid } from './defaults';
import { defaultEffects, type EffectId, type Effects } from './effects';
import { initialWorkingCopy } from './workingCopy';
import { ASPECTS, type AspectId, type Layer, type LayerType, type Project, type PropsOf, type Rect } from './types';

const COALESCE_MS = 400;
const HISTORY_LIMIT = 100;

export const hasSavedProject = () => !!initialWorkingCopy();

/** Undo and redo can remove the selected layer; the selection goes with it. */
const keepSelection = (p: Project, id: string | null) => (id && p.layers.some((l) => l.id === id) ? id : null);

/** The open project as last edited in this browser, restored on reload; the document code keeps it saved. */
const loadWorkingCopy = (): Project => initialWorkingCopy()?.project ?? starterProject();

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastPush: number;
  selectedId: string | null;
  aspect: AspectId;
  assets: Record<string, RuntimeAsset>;

  /** Applies a change and records it for undo; rapid edits (drags, sliders) merge into one step. */
  change: (fn: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (p: Project) => void;
  /** Opens a different project: replaces the layout and clears undo history and selection. */
  openProject: (p: Project) => void;

  select: (id: string | null) => void;
  setAspect: (a: AspectId) => void;

  /** Adds on top of the stack, or at `index` (0 is the bottom). */
  addLayer: <T extends LayerType>(type: T, props?: Partial<PropsOf<T>>, index?: number) => string;
  updateLayer: (id: string, patch: Partial<Omit<Layer, 'props' | 'rects'>>) => void;
  updateProps: (id: string, patch: Record<string, unknown>) => void;
  setRect: (id: string, aspect: AspectId, rect: Rect) => void;
  copyRectToAll: (id: string, from: AspectId) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, delta: number) => void;
  /** Changes one whole-frame effect; projects without effects get the defaults first. */
  setEffect: <K extends EffectId>(id: K, patch: Partial<Effects[K]>) => void;

  registerAssets: (a: RuntimeAsset[]) => void;
  importFiles: (files: File[]) => Promise<RuntimeAsset[]>;
  removeAsset: (id: string) => Promise<void>;
}

const mapLayer = (p: Project, id: string, fn: (l: Layer) => Layer): Project =>
  ({ ...p, layers: p.layers.map((l) => (l.id === id ? fn(l) : l)) });

export const useStore = create<State>((set, get) => ({
  project: loadWorkingCopy(),
  past: [],
  future: [],
  lastPush: 0,
  selectedId: null,
  aspect: 'landscape',
  assets: {},

  change: (fn) => set((s) => {
    const now = performance.now();
    const coalesce = now - s.lastPush < COALESCE_MS;
    return {
      project: fn(s.project),
      past: coalesce ? s.past : [...s.past.slice(-HISTORY_LIMIT), s.project],
      future: [],
      lastPush: now,
    };
  }),
  undo: () => set((s) => s.past.length ? {
    project: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.project, ...s.future], lastPush: 0,
    selectedId: keepSelection(s.past[s.past.length - 1], s.selectedId),
  } : s),
  redo: () => set((s) => s.future.length ? {
    project: s.future[0], future: s.future.slice(1), past: [...s.past, s.project], lastPush: 0,
    selectedId: keepSelection(s.future[0], s.selectedId),
  } : s),
  replaceProject: (p) => set((s) => ({ project: p, past: [...s.past, s.project], future: [], selectedId: null, lastPush: 0 })),
  openProject: (p) => set({ project: p, past: [], future: [], selectedId: null, lastPush: 0 }),

  select: (id) => set({ selectedId: id }),
  setAspect: (aspect) => set({ aspect }),

  addLayer: (type, props, index) => {
    const layer = createLayer(type, props);
    get().change((p) => {
      const layers = [...p.layers];
      layers.splice(index ?? layers.length, 0, layer);
      return { ...p, layers };
    });
    set({ selectedId: layer.id, lastPush: 0 });
    return layer.id;
  },
  updateLayer: (id, patch) => get().change((p) => mapLayer(p, id, (l) => ({ ...l, ...patch }) as Layer)),
  updateProps: (id, patch) => get().change((p) => mapLayer(p, id, (l) => ({ ...l, props: { ...l.props, ...patch } }) as Layer)),
  setRect: (id, aspect, rect) => get().change((p) => mapLayer(p, id, (l) => ({ ...l, rects: { ...l.rects, [aspect]: rect } }))),
  copyRectToAll: (id, from) => get().change((p) => mapLayer(p, id, (l) => {
    // Keep the layer's visual size and centre by converting through pixels of each aspect.
    const r = l.rects[from], src = ASPECTS[from];
    const rects = { ...l.rects };
    for (const a of Object.keys(ASPECTS) as AspectId[]) {
      if (a === from) continue;
      const dst = ASPECTS[a];
      const wPx = r.w * src.w, hPx = r.h * src.h;
      const k = Math.min(1, dst.w / wPx, dst.h / hPx);
      const w = (wPx * k) / dst.w, h = (hPx * k) / dst.h;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      rects[a] = { x: cx - w / 2, y: cy - h / 2, w, h };
    }
    return { ...l, rects };
  })),
  removeLayer: (id) => {
    get().change((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== id) }));
    if (get().selectedId === id) set({ selectedId: null });
  },
  duplicateLayer: (id) => {
    const nid = uid();
    get().change((p) => {
      const i = p.layers.findIndex((l) => l.id === id);
      if (i < 0) return p;
      const copy = { ...structuredClone(p.layers[i]), id: nid, name: `${p.layers[i].name} copy` };
      return { ...p, layers: [...p.layers.slice(0, i + 1), copy, ...p.layers.slice(i + 1)] };
    });
    set({ selectedId: nid, lastPush: 0 });
  },
  moveLayer: (id, delta) => {
    get().change((p) => {
      const i = p.layers.findIndex((l) => l.id === id), j = i + delta;
      if (i < 0 || j < 0 || j >= p.layers.length) return p;
      const layers = [...p.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...p, layers };
    });
    set({ lastPush: 0 });
  },
  setEffect: (id, patch) => get().change((p) => {
    const fx = p.effects ?? defaultEffects();
    return { ...p, effects: { ...fx, [id]: { ...fx[id], ...patch } } };
  }),

  registerAssets: (list) => set((s) => ({ assets: { ...s.assets, ...Object.fromEntries(list.map((a) => [a.meta.id, a])) } })),
  importFiles: async (files) => {
    const out: RuntimeAsset[] = [];
    for (const f of files) {
      try { out.push(await importFile(f)); } catch (e) { alert((e as Error).message); }
    }
    get().registerAssets(out);
    return out;
  },
  removeAsset: async (id) => {
    await deleteStoredAsset(id);
    set((s) => {
      const assets = { ...s.assets };
      URL.revokeObjectURL(assets[id]?.url);
      if (assets[id]?.font) document.fonts.delete(assets[id].font);
      delete assets[id];
      return { assets };
    });
  },
}));

export const useSelectedLayer = () => useStore((s) => s.project.layers.find((l) => l.id === s.selectedId) ?? null);
