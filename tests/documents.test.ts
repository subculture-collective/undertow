import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { starterProject } from '../src/defaults';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), patch: vi.fn(), post: vi.fn(), get: vi.fn(), tx: vi.fn(), state: { project: {}, assets: {} } }));
vi.mock('../src/api/client', () => ({
  api: { PATCH: mocks.patch, POST: mocks.post, GET: mocks.get },
  unwrap: (p: Promise<unknown>) => p,
  ApiProblem: class extends Error { constructor(public status: number, public detail: string) { super(detail); } },
}));
vi.mock('../src/store', () => ({ useStore: {
  getState: () => ({ ...mocks.state, openProject: (project: unknown) => { mocks.state.project = project; }, change: (fn: (p: never) => object) => { mocks.state.project = fn(mocks.state.project as never); } }),
  subscribe: vi.fn(),
} }));
vi.mock('../src/cloud/account', () => ({ isSignedIn: () => true, useAccount: { subscribe: vi.fn(), getState: () => ({ refresh: mocks.refresh }) } }));
vi.mock('../src/idb', () => ({ tx: mocks.tx }));
vi.mock('../src/cloud/media', () => ({ buildManifest: () => [], autoRelink: (project: unknown) => ({ project, missing: [] }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let docs: typeof import('../src/cloud/documents');
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('window', { setTimeout, addEventListener: vi.fn() });
  mocks.state.project = { ...starterProject(), name: 'A' };
  docs = await import('../src/cloud/documents');
  docs.useDoc.setState({ ref: { source: 'cloud', id: 'A', revision: 1 }, status: 'saved' });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps B active when an older save for A completes', async () => {
  const save = deferred<{ id: string; revision: number }>();
  mocks.patch.mockReturnValueOnce(save.promise);
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  mocks.get.mockResolvedValue({ id: 'B', revision: 4, data: { ...starterProject(), name: 'B' }, media: [] });
  await docs.openDoc('cloud', 'B');
  save.resolve({ id: 'A', revision: 2 });
  await vi.advanceTimersByTimeAsync(0);
  expect(docs.useDoc.getState().ref?.id).toBe('B');
  mocks.patch.mockResolvedValue({ id: 'B', revision: 5 });
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.patch.mock.calls.at(-1)?.[1]).toMatchObject({ params: { path: { id: 'B' } }, body: { name: 'B', baseRevision: 4 } });
});

it('serializes saves and uses the completed revision for edits made in flight', async () => {
  const save = deferred<{ id: string; revision: number }>();
  mocks.patch.mockReturnValueOnce(save.promise).mockResolvedValue({ id: 'A', revision: 3 });
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  mocks.state.project = { ...starterProject(), name: 'A edited' };
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  save.resolve({ id: 'A', revision: 2 });
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.patch).toHaveBeenCalledTimes(2);
  expect(mocks.patch.mock.calls[1][1].body).toMatchObject({ name: 'A edited', baseRevision: 2 });
});

it('ignores an error from a save belonging to a previously opened document', async () => {
  const save = deferred<never>();
  mocks.patch.mockReturnValueOnce(save.promise);
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  mocks.get.mockResolvedValue({ id: 'B', revision: 4, data: starterProject(), media: [] });
  await docs.openDoc('cloud', 'B');
  save.reject(new Error('A failed'));
  await vi.advanceTimersByTimeAsync(0);
  expect(docs.useDoc.getState().status).toBe('saved');
  expect(docs.useDoc.getState().ref?.id).toBe('B');
});

it('creates a new project once when more edits arrive during its first save', async () => {
  const save = deferred<{ id: string; revision: number }>();
  mocks.post.mockReturnValueOnce(save.promise);
  mocks.patch.mockResolvedValue({ id: 'created', revision: 2 });
  docs.newDoc({ ...starterProject(), name: 'New' });
  await vi.advanceTimersByTimeAsync(0);
  mocks.state.project = { ...starterProject(), name: 'New edited' };
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  save.resolve({ id: 'created', revision: 1 });
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.patch.mock.calls[0][1]).toMatchObject({ params: { path: { id: 'created' } }, body: { baseRevision: 1, name: 'New edited' } });
});

it('ignores completion of a local save after opening a cloud project', async () => {
  const read = deferred<undefined>();
  mocks.tx.mockReturnValueOnce(read.promise).mockResolvedValue(undefined);
  docs.useDoc.setState({ ref: { source: 'local', id: 'local-A' }, status: 'saved' });
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  mocks.get.mockResolvedValue({ id: 'B', revision: 4, data: starterProject(), media: [] });
  await docs.openDoc('cloud', 'B');
  read.resolve(undefined);
  await vi.advanceTimersByTimeAsync(1);
  expect(docs.useDoc.getState().ref).toEqual({ source: 'cloud', id: 'B', revision: 4 });
});

it('saves edits still waiting for the autosave delay before opening another project', async () => {
  const edited = { ...starterProject(), name: 'A edited' };
  mocks.state.project = edited;
  mocks.patch.mockResolvedValue({ id: 'A', revision: 2 });
  docs.scheduleSave();
  mocks.get.mockResolvedValue({ id: 'B', revision: 4, data: { ...starterProject(), name: 'B' }, media: [] });
  await docs.openDoc('cloud', 'B');
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  expect(mocks.patch.mock.calls[0][1]).toMatchObject({ params: { path: { id: 'A' } }, body: { name: 'A edited', baseRevision: 1 } });
  expect(docs.useDoc.getState().ref).toEqual({ source: 'cloud', id: 'B', revision: 4 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.patch).toHaveBeenCalledTimes(1);
});

it('refuses to open a project whose data is not a layout', async () => {
  mocks.get.mockResolvedValue({ id: 'B', revision: 4, data: { name: 'broken' }, media: [] });
  await expect(docs.openDoc('cloud', 'B')).rejects.toThrow('could not be read');
  expect(docs.useDoc.getState().ref?.id).toBe('A');
});

const problem = async (status: number) => { const { ApiProblem } = await import('../src/api/client'); return new (ApiProblem as unknown as new (s: number, d: string) => Error)(status, `HTTP ${status}`); };

it('offers a new copy instead of retrying when the account project is gone', async () => {
  mocks.patch.mockRejectedValue(await problem(404));
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(docs.useDoc.getState().status).toBe('missing');
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  mocks.post.mockResolvedValue({ id: 'C', revision: 1 });
  await docs.resolveConflict('copy');
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(docs.useDoc.getState()).toMatchObject({ status: 'saved', ref: { id: 'C' } });
});

it('retries a save that failed on the server, with growing delays', async () => {
  mocks.patch.mockRejectedValueOnce(await problem(503)).mockRejectedValueOnce(await problem(500)).mockResolvedValue({ id: 'A', revision: 2 });
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(docs.useDoc.getState()).toMatchObject({ status: 'error', message: expect.stringContaining('5 s') });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(docs.useDoc.getState().message).toContain('15 s');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.patch).toHaveBeenCalledTimes(3);
  expect(docs.useDoc.getState()).toMatchObject({ status: 'saved', ref: { revision: 2 } });
});

it('does not retry a layout the server rejected, and waits for sign-in after a 401', async () => {
  mocks.patch.mockRejectedValueOnce(await problem(422));
  docs.scheduleSave(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  expect(docs.useDoc.getState().status).toBe('error');
  mocks.patch.mockRejectedValueOnce(await problem(401));
  docs.retrySave();
  await vi.advanceTimersByTimeAsync(0);
  expect(docs.useDoc.getState().status).toBe('waiting-sign-in');
  expect(mocks.refresh).toHaveBeenCalled();
});
