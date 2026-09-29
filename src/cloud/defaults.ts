import type { Schemas } from '../api/client';
import type { Layer, Project, SocialItem } from '../types';

/** What new projects start with: artist name, website, socials, palette, font. */
export type Defaults = Schemas['Defaults'];
export type PaletteColors = NonNullable<Schemas['PaletteColors']>;

export const EMPTY_DEFAULTS: Defaults = {
  artistName: '', website: '', socials: [], palette: null, font: '', applyToNewProjects: true,
};

const LOCAL_KEY = 'undertow:defaults';

/** Defaults kept in this browser while signed out. */
export function loadLocalDefaults(): Defaults {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return { ...EMPTY_DEFAULTS, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch { /* ignore */ }
  return EMPTY_DEFAULTS;
}
export function saveLocalDefaults(d: Defaults) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
}

export const hasDefaults = (d: Defaults) => !!(d.artistName || d.website || d.socials.length || d.palette || d.font);

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** Recolours a layer from a palette: meters and spectra use primary/secondary, highlights accent, text the text colour. */
function paintLayer(l: Layer, c: PaletteColors): Layer {
  const p = { ...l.props } as Record<string, unknown>;
  switch (l.type) {
    case 'solid': p.color = c.background; p.color2 = mix(c.background, c.accent, 0.3); break;
    case 'spectrum': p.color = c.primary; p.color2 = c.secondary; break;
    case 'waveform': p.color = `${c.text}66`; p.playedColor = c.primary; break;
    case 'vu': p.low = c.secondary; p.mid = c.accent; p.high = c.primary; break;
    case 'particles': p.color = c.text; p.color2 = c.accent; break;
    case 'text': p.color = c.text; break;
    case 'lyrics': p.color = c.text; p.highlight = c.accent; p.dimColor = `${c.text}99`; break;
    case 'socials': p.color = c.text; if (!p.brandColors) p.iconColor = c.text; break;
    default: return l;
  }
  return { ...l, props: p } as unknown as Layer;
}

const PLACEHOLDER_ARTIST = /\bArtist\b/;

/** Applies an account's defaults to a project: name in titles, socials, palette and font. */
export function applyDefaults(project: Project, d: Defaults): Project {
  const socials: SocialItem[] = [...d.socials];
  if (d.website && !socials.some((s) => s.platform === 'web')) {
    socials.push({ platform: 'web', handle: d.website.replace(/^https?:\/\//, '').replace(/\/$/, '') });
  }
  const layers = project.layers.map((layer) => {
    let l = layer;
    if (l.type === 'text' && d.artistName && PLACEHOLDER_ARTIST.test(l.props.text)) {
      l = { ...l, props: { ...l.props, text: l.props.text.replace(PLACEHOLDER_ARTIST, d.artistName) } };
    }
    if (l.type === 'socials' && socials.length) l = { ...l, props: { ...l.props, items: structuredClone(socials) } };
    if (d.font && (l.type === 'text' || l.type === 'lyrics' || l.type === 'socials')) l = { ...l, props: { ...l.props, font: d.font } } as Layer;
    if (d.palette) l = paintLayer(l, d.palette);
    return l;
  });
  return { ...project, layers };
}
