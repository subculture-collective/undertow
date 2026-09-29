/**
 * Exports data the API serves from the editor's own code: built-in templates,
 * palettes and the Milkdrop preset names. Run from the repo root after changing either:
 *   npm run api:data
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BUILTIN_PALETTES } from '../src/cloud/palettes.ts';
import { TEMPLATES } from '../src/templates.ts';

const out = new URL('../server/src/data/', import.meta.url);

const templates = TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, data: t.build() }));
writeFileSync(new URL('templates.json', out), JSON.stringify(templates, null, 1));
writeFileSync(new URL('palettes.json', out), JSON.stringify(BUILTIN_PALETTES, null, 1));

const require = createRequire(import.meta.url);
const packs = ['butterchurn-presets', 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js',
  'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js', 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js'];
const names = new Set<string>();
for (const p of packs) {
  const m = require(p);
  for (const n of Object.keys((m.default ?? m).getPresets())) names.add(n);
}
writeFileSync(new URL('milkdrop-presets.json', out), JSON.stringify([...names].sort((a, b) => a.localeCompare(b))));
console.log(`Exported ${templates.length} templates, ${BUILTIN_PALETTES.length} palettes and ${names.size} Milkdrop presets.`);
