/** Writes the OpenAPI document to server/openapi.json without starting the server (used to generate the editor's client types). */
import { writeFileSync } from 'node:fs';
import { createApp } from '../app.js';
import { pool } from '../db/index.js';

const res = await createApp().request('/v1/openapi.json');
const doc = await res.json() as { paths: Record<string, unknown> };
writeFileSync(new URL('../../openapi.json', import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote server/openapi.json (${Object.keys(doc.paths).length} paths).`);
await pool.end();
