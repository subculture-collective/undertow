/**
 * The project library and autosave. The open project is saved to the account
 * when signed in and to this browser otherwise. Account saves send the
 * revision they were based on, so an edit from another tab or device is
 * reported as a conflict instead of being overwritten.
 */
import { create } from 'zustand';
import { api, ApiProblem, unwrap } from '../api/client';
import { tx } from '../idb';
import { toProject } from '../projectShape';
import { useStore } from '../store';
import type { Project } from '../types';
import { isSignedIn, useAccount } from './account';
import { autoRelink, buildManifest, type MediaRef } from './media';
import { initialWorkingCopy, writeWorkingCopy, type DocRef, type Source } from '../workingCopy';

export type { DocRef, Source };

export type SaveStatus =
  | 'idle' | 'saving' | 'saved'
  /** Signed out while an account project is open: edits are kept in this browser until you sign in. */
  | 'waiting-sign-in'
  | 'offline' | 'conflict'
  /** The account project is gone (deleted elsewhere, or another account is signed in): save it as a new one. */
  | 'missing'
  /** The save failed; temporary failures retry on their own. */
  | 'error';

export interface LibraryItem {
  source: Source;
  id: string;
  name: string;
  updatedAt: string;
  /** Object URL or API URL for the preview image. */
  thumbnail: string | null;
}

interface LocalRecord { id: string; name: string; data: Project; media: MediaRef[]; updatedAt: string; thumbnail?: Blob }

interface DocState {
  ref: DocRef | null;
  status: SaveStatus;
  message: string;
  /** Files the open project uses that aren't on this device. */
  missing: MediaRef[];
  media: MediaRef[];
}

export const useDoc = create<DocState>(() => ({ ref: initialWorkingCopy()?.ref ?? null, status: 'idle', message: '', missing: [], media: [] }));

// The working copy pairs the layout with the reference and revision its edits are based on.
// A new reference (a save, opening a project) is written at once; edits shortly after they stop.
let workingCopyTimer = 0;
const writeNow = () => {
  clearTimeout(workingCopyTimer);
  writeWorkingCopy({ project: useStore.getState().project, ref: useDoc.getState().ref });
};
useDoc.subscribe((s, prev) => { if (s.ref !== prev.ref) writeNow(); });
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  clearTimeout(workingCopyTimer);
  workingCopyTimer = window.setTimeout(writeNow, 300);
});
window.addEventListener('pagehide', writeNow);

const localId = () => `loc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const nameOf = (p: Project) => p.name.trim() || 'Untitled';

// ---- thumbnails ---------------------------------------------------------------------------------------
let thumbSource: (() => HTMLCanvasElement | null) | null = null;
/** The stage registers its canvas so saves can include a preview image. */
export function registerThumbnailSource(fn: () => HTMLCanvasElement | null) { thumbSource = fn; }

async function captureThumbnail(): Promise<Blob | null> {
  const src = thumbSource?.();
  if (!src?.width) return null;
  const w = 320, h = Math.round((src.height / src.width) * w);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.8));
}

const THUMB_EVERY_MS = 60_000;
let lastThumb = { key: '', at: 0 };
const thumbDue = (ref: DocRef) => lastThumb.key !== `${ref.source}:${ref.id}` || Date.now() - lastThumb.at > THUMB_EVERY_MS;

// ---- saving -------------------------------------------------------------------------------------------------
let loading = false;
let timer = 0;
/** A save is scheduled but its timer hasn't fired yet. */
let pending = false;
let documentGeneration = 0;
let saveChain = Promise.resolve();
/** Failed saves in a row; sets how long the next automatic retry waits. */
let retryAttempt = 0;
const RETRY_MS = [5_000, 15_000, 60_000];

function saveNow() {
  const generation = documentGeneration;
  const save = saveChain.then(() => {
    if (generation === documentGeneration) return saveSnapshot(generation);
  });
  saveChain = save.catch(() => {});
  return save;
}

async function saveSnapshot(generation: number) {
  const { project, assets } = useStore.getState();
  const doc = useDoc.getState();
  // These need a decision first; saving again would only repeat the failure.
  if (doc.status === 'conflict' || doc.status === 'missing') return;
  const media = buildManifest(project, assets, doc.media);
  let ref = doc.ref;

  if (ref?.source === 'cloud' && !isSignedIn()) {
    useDoc.setState({ status: 'waiting-sign-in', message: 'Sign in to save changes to your account. They are kept in this browser meanwhile.' });
    return;
  }
  useDoc.setState({ status: 'saving', message: '' });
  try {
    if (!ref) ref = { source: isSignedIn() ? 'cloud' : 'local', id: '' };
    if (ref.source === 'local') {
      const id = ref.id || localId();
      const prev = ref.id ? await tx<LocalRecord | undefined>('projects', 'readonly', (s) => s.get(id)) : undefined;
      const thumbnail = generation === documentGeneration && thumbDue({ ...ref, id }) ? await captureThumbnail() : null;
      const rec: LocalRecord = {
        id, name: nameOf(project), data: project, media, updatedAt: new Date().toISOString(),
        thumbnail: thumbnail ?? prev?.thumbnail,
      };
      await tx('projects', 'readwrite', (s) => s.put(rec, id));
      if (generation !== documentGeneration) return;
      if (thumbnail) lastThumb = { key: `local:${id}`, at: Date.now() };
      retryAttempt = 0;
      useDoc.setState({ ref: { source: 'local', id }, media, status: useStore.getState().project === project ? 'saved' : 'idle' });
      return;
    }
    const saved = ref.id
      ? await unwrap(api.PATCH('/v1/projects/{id}', { params: { path: { id: ref.id } }, body: { name: nameOf(project), data: project as never, media, baseRevision: ref.revision } }))
      : await unwrap(api.POST('/v1/projects', { body: { name: nameOf(project), data: project as never, media } }));
    if (generation !== documentGeneration) return;
    const next = { source: 'cloud' as const, id: saved.id, revision: saved.revision };
    retryAttempt = 0;
    useDoc.setState({ ref: next, media, status: useStore.getState().project === project ? 'saved' : 'idle' });
    if (thumbDue(next)) void uploadThumbnail(saved.id);
  } catch (e) {
    if (generation !== documentGeneration) return;
    const p = e instanceof ApiProblem ? e : null;
    const code = p?.status;
    if (code === 409) useDoc.setState({ status: 'conflict', message: p?.detail ?? 'This project was changed somewhere else.' });
    else if (code === 0) useDoc.setState({ status: 'offline', message: 'Offline. Your changes are kept in this browser and will save when you reconnect.' });
    else if (code === 401) {
      // The session ended; saving resumes when the account is signed in again.
      useDoc.setState({ status: 'waiting-sign-in', message: 'Your session ended. Sign in to save to your account; your changes are kept in this browser meanwhile.' });
      void useAccount.getState().refresh().catch(() => {});
    } else if (code === 403 || code === 404) {
      useDoc.setState({ status: 'missing', message: 'This project isn’t in the signed-in account any more: it was deleted, or another account is signed in. Your version is kept in this browser; save it as a new project to keep it.' });
    } else {
      const detail = p?.detail ?? (e as Error).message;
      // Server and network trouble usually passes; a rejected layout won't change by itself.
      if (code === undefined || code >= 500 || code === 408 || code === 429) {
        const delay = RETRY_MS[Math.min(retryAttempt++, RETRY_MS.length - 1)];
        useDoc.setState({ status: 'error', message: `${detail} Trying again in ${delay / 1000} s.` });
        scheduleSave(delay);
      } else {
        useDoc.setState({ status: 'error', message: detail });
      }
    }
  }
}

/** Retries a failed save straight away. */
export function retrySave() {
  retryAttempt = 0;
  scheduleSave(0);
}

async function uploadThumbnail(id: string) {
  const blob = await captureThumbnail();
  if (!blob) return;
  lastThumb = { key: `cloud:${id}`, at: Date.now() };
  await fetch(`/v1/projects/${id}/thumbnail`, { method: 'PUT', body: blob, credentials: 'include', headers: { 'content-type': 'image/jpeg' } })
    .catch(() => { /* a missing preview is not worth an error */ });
}

/** Saves soon after edits stop: quickly on this device, a little later to the account. */
export function scheduleSave(delay?: number) {
  clearTimeout(timer);
  const ref = useDoc.getState().ref;
  pending = true;
  timer = window.setTimeout(() => { pending = false; void saveNow(); }, delay ?? (ref?.source === 'local' ? 600 : 2000));
}

/**
 * Saves edits still waiting for the autosave delay before another project
 * replaces this one. Failures stay in the save status; switching goes ahead.
 */
async function flushPendingSave() {
  clearTimeout(timer);
  if (!pending) return;
  pending = false;
  await saveNow().catch(() => {});
}

useStore.subscribe((s, prev) => {
  if (s.project !== prev.project && !loading) scheduleSave();
});

// Retry an offline save when the connection comes back.
window.addEventListener('online', () => { if (useDoc.getState().status === 'offline') scheduleSave(0); });
// Resume saving an account project after signing back in.
useAccount.subscribe((s, prev) => {
  if (s.status === 'signed-in' && prev.status !== 'signed-in' && useDoc.getState().status === 'waiting-sign-in') scheduleSave(0);
});

// ---- opening ----------------------------------------------------------------------------------------------------
function show(project: Project, ref: DocRef, media: MediaRef[]) {
  documentGeneration++;
  retryAttempt = 0;
  const { project: relinked, missing } = autoRelink(project, media, useStore.getState().assets);
  loading = true;
  useStore.getState().openProject(relinked);
  loading = false;
  useDoc.setState({ ref, media, missing, status: 'saved', message: '' });
  // Save straight away if relinking changed references, so the stored layout points at this device's files.
  if (relinked !== project) scheduleSave(0);
}

export async function openDoc(source: Source, id: string) {
  await flushPendingSave();
  const unreadable = () => new Error('That project could not be read. It may come from a newer version of the editor.');
  if (source === 'local') {
    const rec = await tx<LocalRecord | undefined>('projects', 'readonly', (s) => s.get(id));
    if (!rec) throw new Error('That project is no longer on this device.');
    const project = toProject(rec.data);
    if (!project) throw unreadable();
    show(project, { source, id }, rec.media ?? []);
  } else {
    const p = await unwrap(api.GET('/v1/projects/{id}', { params: { path: { id } } }));
    const project = toProject(p.data);
    if (!project) throw unreadable();
    show(project, { source, id, revision: p.revision }, p.media);
  }
}

/** Starts a new project (from a template) and saves it: to the account when signed in. */
export async function newDoc(project: Project) {
  await flushPendingSave();
  documentGeneration++;
  retryAttempt = 0;
  loading = true;
  useStore.getState().openProject(project);
  loading = false;
  useDoc.setState({ ref: null, media: [], missing: [], status: 'idle', message: '' });
  scheduleSave(0);
}

/** After a conflict: load the saved version, or keep this version as a new copy. */
export async function resolveConflict(choice: 'reload' | 'copy') {
  const ref = useDoc.getState().ref;
  if (!ref) return;
  if (choice === 'reload') {
    useDoc.setState({ status: 'idle' });
    await openDoc(ref.source, ref.id);
    return;
  }
  loading = true;
  useStore.getState().change((p) => ({ ...p, name: `${nameOf(p)} (my copy)` }));
  loading = false;
  // An empty id makes the next save create a new project instead of overwriting.
  documentGeneration++;
  useDoc.setState({ ref: { source: ref.source, id: '' }, status: 'idle', message: '' });
  await saveNow();
}

/** Updates the missing-files list after files are added or relinked. */
export function refreshMissing() {
  const { project, assets } = useStore.getState();
  const { media } = useDoc.getState();
  useDoc.setState({ missing: autoRelink(project, media, assets).missing });
}

// ---- library ---------------------------------------------------------------------------------------------------------
const localUrls: string[] = [];

export async function listLocal(): Promise<LibraryItem[]> {
  for (const u of localUrls.splice(0)) URL.revokeObjectURL(u);
  const rows = await tx<LocalRecord[]>('projects', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => {
    const thumbnail = r.thumbnail ? URL.createObjectURL(r.thumbnail) : null;
    if (thumbnail) localUrls.push(thumbnail);
    return { source: 'local' as const, id: r.id, name: r.name, updatedAt: r.updatedAt, thumbnail };
  });
}

export async function listCloud(): Promise<LibraryItem[]> {
  const out: LibraryItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await unwrap(api.GET('/v1/projects', { params: { query: { limit: 100, cursor } } }));
    out.push(...page.items.map((p) => ({
      source: 'cloud' as const, id: p.id, name: p.name, updatedAt: p.updatedAt,
      thumbnail: p.hasThumbnail ? `/v1/projects/${p.id}/thumbnail?v=${p.revision}` : null,
    })));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

export async function deleteDoc(item: Pick<LibraryItem, 'source' | 'id'>) {
  if (item.source === 'local') await tx('projects', 'readwrite', (s) => s.delete(item.id));
  else await unwrap(api.DELETE('/v1/projects/{id}', { params: { path: { id: item.id } } }));
  const ref = useDoc.getState().ref;
  if (ref?.source === item.source && ref.id === item.id) {
    documentGeneration++;
    clearTimeout(timer);
    useDoc.setState({ ref: null, status: 'idle' });
  }
}

export async function renameDoc(item: Pick<LibraryItem, 'source' | 'id'>, name: string) {
  const ref = useDoc.getState().ref;
  if (ref?.source === item.source && ref.id === item.id) {
    useStore.getState().change((p) => ({ ...p, name }));
    return;
  }
  if (item.source === 'local') {
    const rec = await tx<LocalRecord | undefined>('projects', 'readonly', (s) => s.get(item.id));
    if (rec) await tx('projects', 'readwrite', (s) => s.put({ ...rec, name, data: { ...rec.data, name } }, item.id));
  } else {
    await unwrap(api.PATCH('/v1/projects/{id}', { params: { path: { id: item.id } }, body: { name } }));
  }
}

export async function duplicateDoc(item: Pick<LibraryItem, 'source' | 'id'>) {
  if (item.source === 'cloud') {
    await unwrap(api.POST('/v1/projects/{id}/duplicate', { params: { path: { id: item.id } }, body: {} }));
    return;
  }
  const rec = await tx<LocalRecord | undefined>('projects', 'readonly', (s) => s.get(item.id));
  if (!rec) return;
  const id = localId(), name = `${rec.name} copy`;
  await tx('projects', 'readwrite', (s) => s.put({ ...rec, id, name, data: { ...rec.data, name }, updatedAt: new Date().toISOString() }, id));
}

/** Copies a project from this browser into the account, then removes the browser copy. */
export async function moveToAccount(id: string) {
  const rec = await tx<LocalRecord | undefined>('projects', 'readonly', (s) => s.get(id));
  if (!rec) return;
  const created = await unwrap(api.POST('/v1/projects', { body: { name: rec.name, data: rec.data as never, media: rec.media ?? [] } }));
  if (rec.thumbnail) {
    await fetch(`/v1/projects/${created.id}/thumbnail`, { method: 'PUT', body: rec.thumbnail, credentials: 'include', headers: { 'content-type': rec.thumbnail.type || 'image/jpeg' } }).catch(() => {});
  }
  await tx('projects', 'readwrite', (s) => s.delete(id));
  const ref = useDoc.getState().ref;
  if (ref?.source === 'local' && ref.id === id) {
    documentGeneration++;
    useDoc.setState({ ref: { source: 'cloud', id: created.id, revision: created.revision }, status: 'saved' });
  }
}
