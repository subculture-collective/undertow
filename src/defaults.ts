import type { AspectId, Layer, LayerType, PropsOf, Project, Rect, TextStyle } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Converts a rect in pixels of a reference frame into fractions. */
const px = (W: number, H: number, x: number, y: number, w: number, h: number): Rect => ({ x: x / W, y: y / H, w: w / W, h: h / H });
/** Rects from pixel positions in each reference frame: landscape 1920x1080, portrait 1080x1920, square 1080x1080. */
export const L = (x: number, y: number, w: number, h: number) => px(1920, 1080, x, y, w, h);
export const P = (x: number, y: number, w: number, h: number) => px(1080, 1920, x, y, w, h);
export const S = (x: number, y: number, w: number, h: number) => px(1080, 1080, x, y, w, h);

export type Rects = Record<AspectId, Rect>;

export const DEFAULT_RECTS: Record<LayerType, Rects> = {
  solid: { landscape: FULL, portrait: FULL, square: FULL },
  video: { landscape: FULL, portrait: FULL, square: FULL },
  particles: { landscape: FULL, portrait: FULL, square: FULL },
  milkdrop: { landscape: FULL, portrait: FULL, square: FULL },
  image: { landscape: L(660, 240, 600, 600), portrait: P(190, 420, 700, 700), square: S(290, 200, 500, 500) },
  text: { landscape: L(360, 860, 1200, 90), portrait: P(90, 1200, 900, 100), square: S(90, 740, 900, 80) },
  lyrics: { landscape: L(260, 60, 1400, 130), portrait: P(80, 200, 920, 200), square: S(80, 50, 920, 110) },
  socials: { landscape: L(60, 1000, 900, 50), portrait: P(140, 1760, 800, 110), square: S(90, 1000, 900, 50) },
  waveform: { landscape: L(0, 760, 1920, 160), portrait: P(0, 1500, 1080, 180), square: S(0, 820, 1080, 120) },
  spectrum: { landscape: L(360, 650, 1200, 180), portrait: P(90, 1500, 900, 220), square: S(140, 820, 800, 160) },
  vu: { landscape: L(1800, 340, 70, 400), portrait: P(960, 700, 70, 400), square: S(990, 340, 60, 400) },
};

const TEXT: TextStyle = {
  font: 'Inter', weight: 700, color: '#ffffff', align: 'center', shadow: 0.4, uppercase: false, letterSpacing: 0,
};

export const DEFAULT_PROPS: { [T in LayerType]: PropsOf<T> } = {
  solid: { color: '#0b0b12', color2: '#2a1245', gradient: true, angle: 135 },
  video: { assetId: null, fit: 'cover', speed: 1, offset: 0, pulse: 0 },
  particles: {
    style: 'dust', count: 160, color: '#ffffff', color2: '#9fd8ff', size: 1, speed: 1, direction: 270, react: 0.6, seed: 1,
  },
  milkdrop: { preset: '', cycle: 0, blendTime: 2.7, seed: 1, gain: 1 },
  image: { assetId: null, fit: 'cover', radius: 0.03, shadow: 0.5, pulse: 0, spin: 0, circle: false },
  text: { ...TEXT, text: 'Artist — Song Title' },
  lyrics: { ...TEXT, assetId: null, offset: 0, mode: 'karaoke', highlight: '#ffd84d', dimColor: '#8d8d9c', fade: 0.25 },
  socials: {
    font: 'Inter', weight: 600, color: '#ffffff', shadow: 0.4, letterSpacing: 0,
    items: [{ platform: 'instagram', handle: '@yourname' }, { platform: 'spotify', handle: 'Your Artist' }],
    layout: 'row', brandColors: false, iconColor: '#ffffff',
  },
  waveform: { mode: 'scope', style: 'line', color: '#ffffff', playedColor: '#ff4fd8', thickness: 3, glow: 0.5, gain: 1 },
  spectrum: {
    style: 'bars', bars: 64, color: '#4fd1ff', color2: '#ff4fd8', gap: 0.3, rounded: true, smoothing: 0.6,
    minHz: 30, maxHz: 16000, glow: 0.4, sensitivity: 1,
  },
  vu: { style: 'led', orientation: 'vertical', low: '#3ddc84', mid: '#ffd84d', high: '#ff4d4d', segments: 20, peakHold: true, sensitivity: 1 },
};

/** Placement for extra images such as logos, so they don't cover the artwork. */
export const LOGO_RECTS: Rects = { landscape: L(60, 50, 260, 120), portrait: P(60, 60, 260, 120), square: S(40, 40, 220, 100) };

export const LAYER_LABELS: Record<LayerType, string> = {
  solid: 'Background colour',
  video: 'Video background',
  particles: 'Particles',
  milkdrop: 'Milkdrop visualizer',
  image: 'Image / logo',
  text: 'Text',
  lyrics: 'Lyrics',
  socials: 'Socials',
  waveform: 'Waveform',
  spectrum: 'Spectrum',
  vu: 'VU meter',
};

export function createLayer<T extends LayerType>(type: T, overrides: Partial<PropsOf<T>> = {}): Layer {
  return {
    id: uid(),
    type,
    name: LAYER_LABELS[type],
    visible: true,
    opacity: 1,
    blend: type === 'particles' ? 'screen' : 'source-over',
    rects: structuredClone(DEFAULT_RECTS[type]),
    props: { ...structuredClone(DEFAULT_PROPS[type]), ...overrides },
  } as unknown as Layer;
}

export function starterProject(): Project {
  const spectrum = createLayer('spectrum');
  spectrum.blend = 'screen';
  return {
    version: 1,
    name: 'Untitled',
    audioAssetId: null,
    layers: [
      createLayer('solid'),
      createLayer('milkdrop'),
      createLayer('image'),
      spectrum,
      createLayer('text'),
      createLayer('socials'),
    ],
  };
}

/** Where a new video background goes: above any background colours at the bottom, so they don't hide it. */
export function videoBackgroundIndex(layers: Layer[]) {
  let i = 0;
  while (layers[i]?.type === 'solid') i++;
  return i;
}
