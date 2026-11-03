import { createLayer } from './defaults';
import { ASPECT_IDS, type Layer, type LayerType, type Project, type Rect } from './types';

const LAYER_TYPES: readonly LayerType[] = ['solid', 'video', 'particles', 'milkdrop', 'image', 'text', 'lyrics', 'socials', 'waveform', 'spectrum', 'vu'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRect = (v: unknown): v is Rect => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h);

/**
 * Checks a layout read from a file, the working copy or the library before the
 * editor renders it. Missing layer fields take their defaults, layers of a type
 * this version doesn't know are left out, and anything without a layer list is
 * rejected (null), so a bad file can't crash the stage on every reload.
 */
export function toProject(x: unknown): Project | null {
  if (!isObj(x) || !Array.isArray(x.layers)) return null;
  const layers: Layer[] = [];
  for (const l of x.layers) {
    if (!isObj(l) || !LAYER_TYPES.includes(l.type as LayerType)) continue;
    const def = createLayer(l.type as LayerType);
    const rects = isObj(l.rects) ? l.rects : {};
    layers.push({
      ...def,
      id: typeof l.id === 'string' && l.id ? l.id : def.id,
      name: typeof l.name === 'string' ? l.name : def.name,
      visible: typeof l.visible === 'boolean' ? l.visible : def.visible,
      opacity: isNum(l.opacity) ? l.opacity : def.opacity,
      blend: typeof l.blend === 'string' ? l.blend : def.blend,
      rects: Object.fromEntries(ASPECT_IDS.map((a) => [a, isRect(rects[a]) ? rects[a] : def.rects[a]])),
      props: { ...def.props, ...(isObj(l.props) ? l.props : {}) },
    } as Layer);
  }
  return {
    ...x,
    version: 1,
    name: typeof x.name === 'string' ? x.name : 'Untitled',
    audioAssetId: typeof x.audioAssetId === 'string' ? x.audioAssetId : null,
    layers,
  } as Project;
}
