import type { PaletteColors } from './defaults';

/** Built-in palettes, matching the editor's design systems. The API serves the same list (scripts/export-api-data.ts). */
export const BUILTIN_PALETTES: { id: string; name: string; colors: PaletteColors }[] = [
  { id: 'builtin_pastel', name: 'Pastel glitch', colors: { primary: '#ff9fe0', secondary: '#9cecff', accent: '#c7b3ff', background: '#0f0c1c', text: '#f7f3ff' } },
  { id: 'builtin_neon', name: 'Neon', colors: { primary: '#ff2bd6', secondary: '#00e5ff', accent: '#8b5cff', background: '#07060d', text: '#f2eeff' } },
  { id: 'builtin_analogue', name: 'Analogue', colors: { primary: '#ffa53d', secondary: '#8fc9a8', accent: '#e2553d', background: '#110e0b', text: '#f2e8d5' } },
  { id: 'builtin_acid', name: 'Acid', colors: { primary: '#c6ff00', secondary: '#ffffff', accent: '#ff4d00', background: '#000000', text: '#f4f4f4' } },
  { id: 'builtin_studio', name: 'Studio', colors: { primary: '#5b8cff', secondary: '#2dd4bf', accent: '#7c8cff', background: '#0e0f12', text: '#e9ebf0' } },
];
