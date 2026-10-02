import type { ReactNode } from 'react';
import type { AssetKind, LayerType } from '../types';

/**
 * The editor's icons, drawn on one 24-unit grid with one stroke so they sit
 * together at any size. They replace text glyphs, which each system font
 * rendered at a different size and weight.
 */
function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const solid = { fill: 'currentColor', stroke: 'none' } as const;

const LAYER: Record<LayerType, ReactNode> = {
  solid: <rect x="5" y="5" width="14" height="14" {...solid} />,
  video: <><rect x="3" y="5" width="18" height="14" /><path d="M10 9v6l5-3z" {...solid} /></>,
  particles: <><rect x="4" y="5" width="4" height="4" {...solid} /><rect x="15" y="4" width="5" height="5" {...solid} /><rect x="9" y="14" width="6" height="6" {...solid} /></>,
  milkdrop: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M18.4 5.6l-3.2 3.2M8.8 15.2l-3.2 3.2" />,
  image: <><rect x="3" y="4" width="18" height="16" /><path d="M4 18l5-6 4 4 3-3 4 5" /></>,
  text: <path d="M5 5h14M12 5v14" />,
  lyrics: <path d="M4 7h16M4 12h10M4 17h13" />,
  socials: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" /></>,
  waveform: <path d="M2 12h3l2-6 3 12 3-9 2 6 2-3h5" />,
  spectrum: <path d="M5 20v-6M10 20V8M15 20V4M20 20v-9" />,
  vu: <path d="M6 19h4M6 14h4M6 9h4M14 19h4M14 14h4M14 9h4M14 4h4" />,
};

const ASSET: Record<AssetKind, ReactNode> = {
  image: LAYER.image,
  video: LAYER.video,
  lyrics: LAYER.lyrics,
  audio: <><path d="M9 18V5l10-2v13" /><rect x="4" y="15.5" width="5" height="5" {...solid} /><rect x="14" y="13.5" width="5" height="5" {...solid} /></>,
  font: <path d="M5 19l7-14 7 14M8 14h8" />,
};

const UI = {
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  up: <path d="M12 19V6M6 11l6-6 6 6" />,
  down: <path d="M12 5v13M6 13l6 6 6-6" />,
  duplicate: <><rect x="9" y="9" width="11" height="11" /><path d="M5 15V4h11" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  eye: <><path d="M2 12l5-6h10l5 6-5 6H7z" /><rect x="10" y="10" width="4" height="4" {...solid} /></>,
  'eye-off': <><path d="M2 12l5-6h10l5 6-5 6H7z" /><path d="M4 20 20 4" /></>,
  play: <path d="M7 4v16l13-8z" {...solid} />,
  pause: <><rect x="6" y="4" width="4.5" height="16" {...solid} /><rect x="13.5" y="4" width="4.5" height="16" {...solid} /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  pencil: <path d="M4 20l1-5L16 4l4 4L9 19z" />,
  download: <path d="M12 4v12M6 11l6 6 6-6M4 21h16" />,
  prev: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
} as const;

export type UiIcon = keyof typeof UI;

export const Icon = ({ name, size }: { name: UiIcon; size?: number }) => <Svg size={size}>{UI[name]}</Svg>;
export const LayerIcon = ({ type, size }: { type: LayerType; size?: number }) => <Svg size={size}>{LAYER[type]}</Svg>;
export const AssetIcon = ({ kind, size }: { kind: AssetKind; size?: number }) => <Svg size={size}>{ASSET[kind]}</Svg>;
