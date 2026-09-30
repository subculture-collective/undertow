/**
 * Built-in fonts, bundled with the app so every platform draws the same text,
 * including the Linux render worker. All are SIL Open Font License 1.1, from
 * Fontsource.
 *
 * Layouts made before the fonts were bundled name macOS system fonts.
 * `resolveFont` maps each of those to the bundled font that stands in for it.
 */
import antonExt from '@fontsource/anton/files/anton-latin-ext-400-normal.woff2?url';
import anton from '@fontsource/anton/files/anton-latin-400-normal.woff2?url';
import courier400Ext from '@fontsource/courier-prime/files/courier-prime-latin-ext-400-normal.woff2?url';
import courier400 from '@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?url';
import courier700Ext from '@fontsource/courier-prime/files/courier-prime-latin-ext-700-normal.woff2?url';
import courier700 from '@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?url';
import gelasioExt from '@fontsource-variable/gelasio/files/gelasio-latin-ext-wght-normal.woff2?url';
import gelasio from '@fontsource-variable/gelasio/files/gelasio-latin-wght-normal.woff2?url';
import interExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import jostExt from '@fontsource-variable/jost/files/jost-latin-ext-wght-normal.woff2?url';
import jost from '@fontsource-variable/jost/files/jost-latin-wght-normal.woff2?url';
import nunitoExt from '@fontsource-variable/nunito-sans/files/nunito-sans-latin-ext-wght-normal.woff2?url';
import nunito from '@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2?url';
import type { BuiltinFont } from './types';

// Fontsource's Latin and Latin Extended subsets. Other scripts fall back to system fonts.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

// Each face covers a weight range so the browser picks the nearest real weight
// instead of faking bold on a font that has only one (Anton) or two (Courier Prime).
const FACES: [BuiltinFont, weight: string, latin: string, latinExt: string][] = [
  ['Inter', '1 1000', inter, interExt],
  ['Nunito Sans', '1 1000', nunito, nunitoExt],
  ['Jost', '1 1000', jost, jostExt],
  ['Gelasio', '1 1000', gelasio, gelasioExt],
  ['Anton', '1 1000', anton, antonExt],
  ['Courier Prime', '1 550', courier400, courier400Ext],
  ['Courier Prime', '551 1000', courier700, courier700Ext],
];

/** Old built-in names (macOS system fonts) and the bundled font that replaces each. */
const LEGACY: Record<string, BuiltinFont> = {
  'Helvetica Neue': 'Inter',
  'system-ui': 'Inter',
  'Avenir Next': 'Nunito Sans',
  Futura: 'Jost',
  Georgia: 'Gelasio',
  Impact: 'Anton',
  'Courier New': 'Courier Prime',
};

/** The family to draw with: bundled replacements for old names, anything else unchanged. */
export const resolveFont = (font: string) => LEGACY[font] ?? font;

let ready: Promise<void> | null = null;

/**
 * Registers and loads every built-in font. Canvas text drawn before a font
 * loads uses the fallback, so exports wait for this. Failures are logged, not
 * thrown: text still draws, in the fallback font.
 */
export function builtinFontsReady(): Promise<void> {
  ready ??= Promise.all(FACES.flatMap(([family, weight, ...files]) => files.map((url, i) => {
    const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, unicodeRange: i ? LATIN_EXT : LATIN, display: 'block' });
    document.fonts.add(face);
    return face.load().catch((e) => console.warn('could not load font', family, e));
  }))).then(() => undefined);
  return ready;
}
