import butterchurnModule from 'butterchurn';
import type { AudioFrame } from '../audio/analysis';
import type { MilkdropProps } from '../types';

type PresetMap = Record<string, object>;
let presets: PresetMap | null = null;
let presetNames: string[] = [];
let loading: Promise<PresetMap> | null = null;

/** The preset packs are several MB, so they load on first use. */
export function loadPresets(): Promise<PresetMap> {
  loading ??= Promise.all([
    import('butterchurn-presets'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra2.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsMD1.min.js'),
  ]).then((mods) => {
    const all: PresetMap = {};
    for (const m of mods) {
      const pack = (m as { default?: { getPresets(): PresetMap } }).default ?? (m as unknown as { getPresets(): PresetMap });
      Object.assign(all, pack.getPresets());
    }
    presets = all;
    presetNames = Object.keys(all).sort((a, b) => a.localeCompare(b));
    return all;
  });
  return loading;
}
export const getPresetNames = () => presetNames;

/** Deterministic pick for cycle segment k, so previews and exports agree. */
function pickPreset(seed: number, k: number): string {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return presetNames[h % presetNames.length];
}

let sharedAudioCtx: AudioContext | null = null;

// The UMD bundle can arrive wrapped in one or two `default` layers depending on the bundler.
type BC = typeof butterchurnModule;
const unwrap = (m: unknown): BC => {
  let x = m as { default?: unknown; createVisualizer?: unknown };
  while (x && !x.createVisualizer && x.default) x = x.default as typeof x;
  return x as BC;
};
const butterchurn = unwrap(butterchurnModule);

interface Visualizer {
  setRendererSize(w: number, h: number): void;
  loadPreset(p: object, blend: number): void;
  render(opts: { elapsedTime: number; audioLevels: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array } }): void;
}

export class MilkInstance {
  readonly canvas = document.createElement('canvas');
  private viz: Visualizer;
  private loadedKey = '';
  private bytes = [new Uint8Array(1024), new Uint8Array(1024), new Uint8Array(1024)];

  constructor(w: number, h: number) {
    sharedAudioCtx ??= new AudioContext();
    this.canvas.width = w;
    this.canvas.height = h;
    this.viz = butterchurn.createVisualizer(sharedAudioCtx, this.canvas, { width: w, height: h, pixelRatio: 1, textureRatio: 1 });
  }

  resize(w: number, h: number) {
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.viz.setRendererSize(w, h);
  }

  render(p: MilkdropProps, t: number, dt: number, frame: AudioFrame) {
    if (!presets || !presetNames.length) return false;
    const k = p.cycle > 0 ? Math.floor(t / p.cycle) : 0;
    const name = k === 0 && presets[p.preset] ? p.preset : pickPreset(p.seed, k);
    const key = `${name}|${k}`;
    if (key !== this.loadedKey) {
      // Blend on scheduled changes; switch instantly on the first load or a manual pick.
      const scheduled = this.loadedKey.split('|')[1] !== String(k) && this.loadedKey !== '';
      this.viz.loadPreset(presets[name], scheduled ? p.blendTime : 0);
      this.loadedKey = key;
    }
    const src = [frame.mono, frame.left, frame.right];
    for (let c = 0; c < 3; c++) {
      const s = src[c], b = this.bytes[c], off = s.length - 1024;
      for (let i = 0; i < 1024; i++) b[i] = Math.max(0, Math.min(255, Math.round(128 + s[off + i] * p.gain * 128)));
    }
    this.viz.render({
      elapsedTime: dt,
      audioLevels: { timeByteArray: this.bytes[0], timeByteArrayL: this.bytes[1], timeByteArrayR: this.bytes[2] },
    });
    return true;
  }

  currentPreset() { return this.loadedKey.split('|')[0]; }

  dispose() {
    (this.canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
