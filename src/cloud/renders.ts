/**
 * Cloud rendering from the editor: create a job, upload the files the layout
 * uses, start it, and follow its progress. Jobs keep running on the server
 * after the dialog closes; the list is polled while any are active.
 */
import { create } from 'zustand';
import { api, ApiProblem, unwrap, type Schemas } from '../api/client';
import type { RuntimeAsset } from '../assets';
import type { Project } from '../types';
import { referencedIds } from './media';

export type RenderJob = Schemas['RenderJob'];
export type RenderOptions = Schemas['RenderOptions'];
export type Usage = Schemas['Usage'];

const ACTIVE = new Set(['awaiting_upload', 'queued', 'running']);
export const isActive = (j: RenderJob) => ACTIVE.has(j.status);

interface RendersState {
  jobs: RenderJob[];
  /** Called with each job that finishes while the editor is open. */
  onFinished: ((j: RenderJob) => void) | null;
  refresh: () => Promise<void>;
}

export const useRenders = create<RendersState>((set, get) => ({
  jobs: [],
  onFinished: null,
  refresh: async () => {
    const before = new Map(get().jobs.map((j) => [j.id, j.status]));
    const jobs = await unwrap(api.GET('/v1/renders'));
    set({ jobs });
    for (const j of jobs) {
      const was = before.get(j.id);
      if (was && ACTIVE.has(was) && (j.status === 'done' || j.status === 'failed')) get().onFinished?.(j);
    }
    schedulePoll();
  },
}));

let pollTimer = 0;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (useRenders.getState().jobs.some(isActive)) {
    pollTimer = window.setTimeout(() => void useRenders.getState().refresh().catch(() => schedulePoll()), 3000);
  }
}

/** Uploads a file with progress, which fetch can't report. */
function uploadWithProgress(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let detail = xhr.statusText;
      try { detail = (JSON.parse(xhr.responseText) as { detail?: string }).detail ?? detail; } catch { /* keep statusText */ }
      reject(new ApiProblem(xhr.status, 'Upload failed', detail));
    };
    xhr.onerror = () => reject(new ApiProblem(0, 'Offline', 'The upload was interrupted. Check your connection and try again.'));
    xhr.send(blob);
  });
}

/**
 * Creates a job for one format, uploads the files it needs (each once), and
 * starts it. `onUpload` reports bytes sent out of the total.
 */
export async function submitRender(
  project: Project, assets: Record<string, RuntimeAsset>, options: RenderOptions,
  onUpload: (sent: number, total: number) => void,
): Promise<RenderJob> {
  const ids = [...referencedIds(project)];
  const missing = ids.filter((id) => !assets[id]);
  if (missing.length) throw new Error('Some files this project uses aren’t on this device. Add them first (see the bar above the stage).');
  const media = ids.map((id) => {
    const a = assets[id];
    return { id, kind: a.meta.kind, name: a.meta.name, size: a.blob.size, mime: a.blob.type || a.meta.mime || 'application/octet-stream' };
  });
  const job = await unwrap(api.POST('/v1/renders', { body: { data: project as never, media, options } }));
  const total = job.uploads.reduce((s, u) => s + u.size, 0);
  let done = 0;
  for (const u of job.uploads) {
    await uploadWithProgress(`/v1/renders/${job.id}/media/${encodeURIComponent(u.mediaId)}`, assets[u.mediaId].blob, (n) => onUpload(done + n, total));
    done += u.size;
  }
  const started = await unwrap(api.POST('/v1/renders/{id}/start', { params: { path: { id: job.id } } }));
  await useRenders.getState().refresh();
  return started;
}

/** Cancels an active job, or deletes a finished one and its output. */
export async function removeRender(id: string) {
  await unwrap(api.DELETE('/v1/renders/{id}', { params: { path: { id } } }));
  await useRenders.getState().refresh();
}

export const outputUrl = (id: string) => `/v1/renders/${id}/output`;

export async function loadUsage(): Promise<Usage> {
  return unwrap(api.GET('/v1/usage', { params: { query: { days: 1 } } }));
}
