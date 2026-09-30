import type { RuntimeAsset } from './assets';
import { createLayer, L, P, S, starterProject, type Rects } from './defaults';
import type { BlendMode, Layer, LayerType, Project, PropsOf, Rect } from './types';

export interface Template {
  id: string;
  name: string;
  description: string;
  build: () => Project;
}

interface LayerSpec<T extends LayerType> {
  name?: string;
  props?: Partial<PropsOf<T>>;
  /** Landscape, portrait and square placement; omitted means the layer's default. */
  at?: [Rect, Rect, Rect];
  blend?: BlendMode;
  opacity?: number;
}

function layer<T extends LayerType>(type: T, spec: LayerSpec<T> = {}): Layer {
  const l = createLayer(type, spec.props);
  if (spec.name) l.name = spec.name;
  if (spec.at) l.rects = { landscape: spec.at[0], portrait: spec.at[1], square: spec.at[2] } satisfies Rects;
  if (spec.blend) l.blend = spec.blend;
  if (spec.opacity !== undefined) l.opacity = spec.opacity;
  return l;
}

const project = (layers: Layer[]): Project => ({ version: 1, name: 'Untitled', audioAssetId: null, layers });

export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Milkdrop visuals behind cover art, a spectrum, title and socials.',
    build: starterProject,
  },
  {
    id: 'vinyl',
    name: 'Vinyl',
    description: 'Spinning circular artwork inside a radial spectrum ring, with a song progress bar.',
    build: () => project([
      layer('solid', { props: { color: '#140d1c', color2: '#3b1a33', gradient: true, angle: 120 } }),
      layer('particles', { props: { style: 'dust', count: 120, color: '#ffd9f0', color2: '#ffb36b', size: 0.8, speed: 0.6 }, opacity: 0.7 }),
      layer('spectrum', {
        name: 'Ring',
        props: { style: 'radial', bars: 120, color: '#ff7ab8', color2: '#ffc46b', gap: 0.35, glow: 0.6, sensitivity: 1.1 },
        at: [L(520, 40, 880, 880), P(100, 380, 880, 880), S(240, 60, 600, 600)],
        blend: 'screen',
      }),
      layer('image', {
        name: 'Artwork',
        props: { circle: true, spin: 8, shadow: 0.7, pulse: 0.3 },
        at: [L(740, 260, 440, 440), P(320, 600, 440, 440), S(390, 210, 300, 300)],
      }),
      layer('text', {
        name: 'Title',
        props: { text: 'Artist — Song Title', font: 'Nunito Sans', weight: 600, letterSpacing: 0.04 },
        at: [L(360, 930, 1200, 70), P(90, 1340, 900, 110), S(90, 720, 900, 80)],
      }),
      layer('waveform', {
        name: 'Progress',
        props: { mode: 'progress', style: 'bars', color: '#ffffff55', playedColor: '#ff7ab8', thickness: 4, glow: 0.2, gain: 1.4 },
        at: [L(560, 1015, 800, 40), P(140, 1500, 800, 70), S(190, 860, 700, 60)],
      }),
    ]),
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    description: 'Big word-by-word lyrics over soft Milkdrop, with the artwork and title in the corner.',
    build: () => project([
      layer('solid', { props: { color: '#07070c', color2: '#141030', gradient: true, angle: 90 } }),
      layer('milkdrop', { props: { preset: 'Flexi + Martin - astral projection', gain: 0.8 }, opacity: 0.45 }),
      layer('lyrics', {
        props: { mode: 'karaoke', font: 'Inter', weight: 900, highlight: '#6bf0ff', dimColor: '#ffffffaa', shadow: 0.6 },
        at: [L(160, 360, 1600, 320), P(60, 700, 960, 440), S(60, 360, 960, 320)],
      }),
      layer('image', {
        name: 'Artwork',
        props: { radius: 0.08, shadow: 0.5 },
        at: [L(60, 60, 160, 160), P(60, 80, 180, 180), S(40, 40, 140, 140)],
      }),
      layer('text', {
        name: 'Title',
        props: { text: 'Artist — Song Title', align: 'left', weight: 600, shadow: 0.5 },
        at: [L(250, 100, 900, 80), P(270, 125, 760, 90), S(200, 75, 840, 70)],
      }),
      layer('waveform', {
        name: 'Progress',
        props: { mode: 'progress', style: 'line', color: '#ffffff44', playedColor: '#6bf0ff', thickness: 3, glow: 0.4 },
        at: [L(60, 990, 1800, 50), P(60, 1780, 960, 70), S(40, 990, 1000, 50)],
      }),
    ]),
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'A starfield warp with a glowing mirrored spectrum, spaced-out title and LED meter.',
    build: () => project([
      layer('solid', { props: { color: '#03020a', color2: '#1b0a3e', gradient: true, angle: 90 } }),
      layer('particles', { props: { style: 'starfield', count: 350, color: '#ffffff', color2: '#b18cff', size: 1, speed: 1, react: 0.9 } }),
      layer('spectrum', {
        props: { style: 'mirror', bars: 96, color: '#00e5ff', color2: '#ff2bd6', gap: 0.35, glow: 0.8, sensitivity: 1.1 },
        at: [L(160, 330, 1600, 420), P(40, 680, 1000, 520), S(40, 290, 1000, 360)],
        blend: 'screen',
      }),
      layer('text', {
        name: 'Title',
        props: { text: 'Artist — Song Title', font: 'Jost', weight: 700, uppercase: true, letterSpacing: 0.2, color: '#f2e9ff' },
        at: [L(260, 800, 1400, 100), P(60, 1290, 960, 120), S(60, 700, 960, 90)],
      }),
      layer('vu', {
        props: { style: 'led', segments: 24, low: '#00e5ff', mid: '#b18cff', high: '#ff2bd6' },
        at: [L(1830, 330, 50, 420), P(990, 300, 50, 320), S(1010, 290, 50, 360)],
      }),
      layer('socials', {
        props: { color: '#d9ccff', iconColor: '#d9ccff', weight: 400 },
        at: [L(460, 975, 1000, 50), P(140, 1740, 800, 110), S(140, 960, 800, 60)],
      }),
    ]),
  },
  {
    id: 'poster',
    name: 'Poster',
    description: 'A light, print-style layout: large artwork, serif title and ink-coloured spectrum.',
    build: () => project([
      layer('solid', { props: { color: '#f3ebe1', color2: '#dcc8b3', gradient: true, angle: 160 } }),
      layer('particles', { props: { style: 'bokeh', count: 30, color: '#ffffff', color2: '#ffe2c4', size: 1.4, speed: 0.5, react: 0.3 }, opacity: 0.8 }),
      layer('image', {
        name: 'Artwork',
        props: { radius: 0.02, shadow: 0.6 },
        at: [L(140, 190, 700, 700), P(140, 200, 800, 800), S(70, 140, 500, 500)],
      }),
      layer('text', {
        name: 'Title',
        props: { text: 'Song Title', font: 'Gelasio', weight: 700, color: '#1d1a17', align: 'left', shadow: 0 },
        at: [L(920, 320, 860, 170), P(90, 1080, 900, 150), S(610, 220, 420, 140)],
      }),
      layer('text', {
        name: 'Subtitle',
        props: { text: 'Artist · Out now', font: 'Nunito Sans', weight: 400, color: '#5b4d40', align: 'left', shadow: 0, letterSpacing: 0.06 },
        at: [L(920, 500, 860, 64), P(90, 1240, 900, 70), S(610, 370, 420, 50)],
      }),
      layer('spectrum', {
        props: { style: 'bars', bars: 48, color: '#1d1a17', color2: '#8a5a33', gap: 0.45, glow: 0, sensitivity: 1 },
        at: [L(920, 640, 860, 220), P(140, 1400, 800, 260), S(610, 470, 420, 170)],
      }),
    ]),
  },
  {
    id: 'clip',
    name: 'Video loop',
    description: 'Your own looping clip under a dark wash, with a glowing line spectrum and title.',
    build: () => project([
      layer('video'),
      layer('solid', { name: 'Wash', props: { color: '#000000', color2: '#1a0a2a', gradient: true, angle: 90 }, opacity: 0.45 }),
      layer('spectrum', {
        props: { style: 'line', bars: 72, color: '#ffffff', color2: '#ffd84d', glow: 0.7, smoothing: 0.7 },
        at: [L(0, 760, 1920, 320), P(0, 1500, 1080, 420), S(0, 800, 1080, 280)],
        blend: 'screen',
      }),
      layer('text', {
        name: 'Title',
        props: { text: 'Artist — Song Title', weight: 900, shadow: 0.7 },
        at: [L(260, 440, 1400, 140), P(60, 820, 960, 180), S(60, 460, 960, 130)],
      }),
      layer('socials', { at: [L(460, 980, 1000, 50), P(140, 1760, 800, 110), S(140, 990, 800, 50)] }),
    ]),
  },
];

/**
 * Builds a template around the current project: the song, artwork, clip,
 * lyrics, title and socials carry over, so trying templates is non-destructive.
 */
export function applyTemplate(t: Template, current: Project, assets: Record<string, RuntimeAsset>): Project {
  const next = t.build();
  next.name = current.name;
  next.audioAssetId = current.audioAssetId;

  const firstAsset = (type: 'image' | 'video' | 'lyrics') => {
    for (const l of current.layers) if (l.type === type && l.props.assetId && assets[l.props.assetId]) return l.props.assetId;
    return Object.values(assets).find((a) => a.meta.kind === type)?.meta.id ?? null;
  };
  const fill: Record<string, string | null> = { image: firstAsset('image'), video: firstAsset('video'), lyrics: firstAsset('lyrics') };
  const filled = new Set<string>();
  for (const l of next.layers) {
    if ((l.type === 'image' || l.type === 'video' || l.type === 'lyrics') && !filled.has(l.type)) {
      l.props.assetId = fill[l.type];
      filled.add(l.type);
    }
  }

  // Keep the user's own words rather than the placeholder copy.
  const title = current.layers.find((l) => l.type === 'text');
  const nextTitle = next.layers.find((l) => l.type === 'text');
  if (title?.type === 'text' && nextTitle?.type === 'text' && title.props.text !== 'Artist — Song Title') nextTitle.props.text = title.props.text;
  const socials = current.layers.find((l) => l.type === 'socials');
  for (const l of next.layers) if (l.type === 'socials' && socials?.type === 'socials') l.props.items = structuredClone(socials.props.items);
  return next;
}
