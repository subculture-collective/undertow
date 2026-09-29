/**
 * Design system selection while the look is being decided. Open the editor
 * with ?theme=glitch (or neon, studio, analogue, acid) to try one. The choice is
 * remembered in this browser, and ?theme=neon returns to the default.
 */
export const THEMES = [
  { id: 'neon', name: 'Neon', summary: 'Club lighting: violet-black, magenta to cyan gradient, glow. The current draft.' },
  { id: 'studio', name: 'Studio', summary: 'Calm graphite with one blue accent and no glow, so the visuals carry the colour.' },
  { id: 'analogue', name: 'Analogue', summary: 'Warm charcoal and cream, VU-meter amber to red, serif wordmark.' },
  { id: 'acid', name: 'Acid', summary: 'Brutalist black and white, acid lime, square corners, hard shadows, monospace.' },
  { id: 'glitch', name: 'Glitch', summary: 'Neubrutalist: pastel pink, sky and lilac, thick outlines, hard shadows, colour split, glitching wordmark.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'vizstudio:theme';
const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);

export function applyTheme(id: ThemeId) {
  if (id === 'neon') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable: the theme still applies for this visit */ }
}

/** Applies ?theme= if present, otherwise the last theme chosen in this browser. */
export function initTheme(): ThemeId {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* ignore */ }
  const id = isTheme(fromUrl) ? fromUrl : isTheme(stored) ? stored : 'neon';
  applyTheme(id);
  return id;
}
