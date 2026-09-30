/**
 * The page the cloud render worker opens in headless Chrome:
 *   /render.html?job=<id>&token=<job token>
 * It loads the job's layout and files from the API, renders with the same
 * exportVideo code as the editor (without audio; the worker muxes the
 * original song), and hands the MP4 to the worker as a download.
 * window.__render reports progress to the worker.
 */
import { hydrate, type RuntimeAsset } from './assets';
import { exportVideo, type ExportOptions } from './export/exportVideo';
import type { AssetKind, Project } from './types';

interface JobMedia { mediaId: string; kind: AssetKind; name: string; mime: string; size: number }
interface JobSpec { name: string; data: Project; options: Omit<ExportOptions, 'includeAudio'> }

type RenderState = { stage: string; frame: number; frames: number; done: boolean; error: string | null };
const state: RenderState = { stage: 'starting', frame: 0, frames: 0, done: false, error: null };
(window as unknown as { __render: RenderState }).__render = state;
const status = document.getElementById('status')!;
const set = (patch: Partial<RenderState>) => { Object.assign(state, patch); status.textContent = JSON.stringify(state); };

async function run() {
  const q = new URLSearchParams(location.search);
  const id = q.get('job'), token = q.get('token');
  if (!id || !token) throw new Error('Missing job or token.');
  const auth = { authorization: `Bearer ${token}` };
  const get = async (path: string) => {
    const res = await fetch(`/internal/jobs/${id}/${path}`, { headers: auth });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res;
  };

  set({ stage: 'loading' });
  const { spec, media } = await (await get('spec')).json() as { spec: JobSpec; media: JobMedia[] };
  const assets: Record<string, RuntimeAsset> = {};
  for (const m of media) {
    const blob = await (await get(`media/${encodeURIComponent(m.mediaId)}`)).blob();
    assets[m.mediaId] = await hydrate({ id: m.mediaId, kind: m.kind, name: m.name, mime: m.mime }, new Blob([blob], { type: m.mime }));
  }
  const track = spec.data.audioAssetId ? assets[spec.data.audioAssetId]?.track ?? null : null;

  set({ stage: 'rendering' });
  const result = await exportVideo(spec.data, track, assets, { ...spec.options, includeAudio: false },
    (p) => set({ frame: p.frame, frames: p.frames }), new AbortController().signal);

  set({ stage: 'saving' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(result.blob);
  a.download = `${id}.mp4`;
  document.body.append(a);
  a.click();
  set({ done: true, stage: 'done' });
}

run().catch((e) => set({ error: String((e as Error)?.message ?? e), stage: 'failed' }));
