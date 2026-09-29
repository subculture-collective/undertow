export type AspectId = 'landscape' | 'portrait' | 'square';

export const ASPECTS: Record<AspectId, { label: string; w: number; h: number }> = {
  landscape: { label: 'Landscape 16:9', w: 1920, h: 1080 },
  portrait: { label: 'Portrait 9:16', w: 1080, h: 1920 },
  square: { label: 'Square 1:1', w: 1080, h: 1080 },
};
export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

/** Position and size as fractions of the canvas, so layouts survive any export resolution. */
export interface Rect { x: number; y: number; w: number; h: number }

export type LayerType =
  | 'solid' | 'video' | 'particles' | 'milkdrop' | 'image' | 'text' | 'lyrics' | 'socials' | 'waveform' | 'spectrum' | 'vu';

export type BlendMode = 'source-over' | 'screen' | 'lighter' | 'multiply' | 'overlay' | 'soft-light' | 'difference';

export interface LayerBase<T extends LayerType, P> {
  id: string;
  type: T;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  /** Independent placement per aspect ratio: one project, several exports. */
  rects: Record<AspectId, Rect>;
  props: P;
}

export interface SolidProps { color: string; color2: string; gradient: boolean; angle: number }

export interface VideoProps {
  assetId: string | null;
  fit: 'contain' | 'cover' | 'stretch';
  /** Playback rate; the clip loops for the length of the song. */
  speed: number;
  /** Seconds into the clip at which the song starts. */
  offset: number;
  /** Brightness boost driven by bass, 0 disables. */
  pulse: number;
}

export type ParticleStyle = 'dust' | 'bokeh' | 'embers' | 'snow' | 'starfield';

export interface ParticlesProps {
  style: ParticleStyle;
  count: number;
  color: string;
  color2: string;
  size: number;
  speed: number;
  /** Degrees of travel for drifting styles; 270 is up. Ignored by the starfield. */
  direction: number;
  /** How much the bass speeds up and enlarges particles. */
  react: number;
  seed: number;
}

export interface MilkdropProps {
  preset: string;
  /** Seconds between automatic preset changes; 0 keeps one preset. */
  cycle: number;
  blendTime: number;
  seed: number;
  gain: number;
}

export interface ImageProps {
  assetId: string | null;
  fit: 'contain' | 'cover' | 'stretch';
  radius: number;
  shadow: number;
  /** Scale boost driven by bass, 0 disables. */
  pulse: number;
  /** Rotations per minute, e.g. a spinning vinyl label. */
  spin: number;
  circle: boolean;
}

export const BUILTIN_FONTS = ['Helvetica Neue', 'system-ui', 'Avenir Next', 'Futura', 'Georgia', 'Impact', 'Courier New'] as const;

export interface TextStyle {
  /** A built-in family name, or the family registered for an uploaded font asset (see `fontFamily`). */
  font: string;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  shadow: number;
  uppercase: boolean;
  letterSpacing: number;
}

export interface TextProps extends TextStyle { text: string }

export interface LyricsProps extends TextStyle {
  assetId: string | null;
  offset: number;
  mode: 'line' | 'line+next' | 'karaoke';
  highlight: string;
  dimColor: string;
  fade: number;
}

export type SocialPlatform =
  | 'instagram' | 'tiktok' | 'youtube' | 'spotify' | 'applemusic' | 'soundcloud' | 'bandcamp'
  | 'x' | 'threads' | 'bluesky' | 'facebook' | 'twitch' | 'discord' | 'patreon' | 'linktree' | 'deezer' | 'tidal' | 'web';

export interface SocialItem { platform: SocialPlatform; handle: string }

export interface SocialsProps extends Omit<TextStyle, 'align' | 'uppercase'> {
  items: SocialItem[];
  layout: 'row' | 'column';
  brandColors: boolean;
  iconColor: string;
}

export interface WaveformProps {
  mode: 'scope' | 'progress';
  style: 'line' | 'mirror' | 'bars';
  color: string;
  playedColor: string;
  thickness: number;
  glow: number;
  gain: number;
}

export interface SpectrumProps {
  style: 'bars' | 'mirror' | 'radial' | 'line';
  bars: number;
  color: string;
  color2: string;
  gap: number;
  rounded: boolean;
  smoothing: number;
  minHz: number;
  maxHz: number;
  glow: number;
  sensitivity: number;
}

export interface VuProps {
  style: 'led' | 'bar' | 'needle';
  orientation: 'vertical' | 'horizontal';
  low: string;
  mid: string;
  high: string;
  segments: number;
  peakHold: boolean;
  sensitivity: number;
}

export type SolidLayer = LayerBase<'solid', SolidProps>;
export type VideoLayer = LayerBase<'video', VideoProps>;
export type ParticlesLayer = LayerBase<'particles', ParticlesProps>;
export type MilkdropLayer = LayerBase<'milkdrop', MilkdropProps>;
export type ImageLayer = LayerBase<'image', ImageProps>;
export type TextLayer = LayerBase<'text', TextProps>;
export type LyricsLayer = LayerBase<'lyrics', LyricsProps>;
export type SocialsLayer = LayerBase<'socials', SocialsProps>;
export type WaveformLayer = LayerBase<'waveform', WaveformProps>;
export type SpectrumLayer = LayerBase<'spectrum', SpectrumProps>;
export type VuLayer = LayerBase<'vu', VuProps>;

export type Layer =
  | SolidLayer | VideoLayer | ParticlesLayer | MilkdropLayer | ImageLayer | TextLayer | LyricsLayer
  | SocialsLayer | WaveformLayer | SpectrumLayer | VuLayer;

export type PropsOf<T extends LayerType> = Extract<Layer, { type: T }>['props'];

export interface Project {
  version: 1;
  name: string;
  /** Bottom-most layer first. */
  layers: Layer[];
  audioAssetId: string | null;
}

export type AssetKind = 'image' | 'audio' | 'lyrics' | 'video' | 'font';

export interface AssetMeta { id: string; kind: AssetKind; name: string; mime: string }
