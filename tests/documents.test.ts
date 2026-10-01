import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { starterProject } from '../src/defaults';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), get: vi.fn(), tx: vi.fn(), state: { project: {}, assets: {} } }));
vi.mock('../src/api/client', () => ({
  api: { PATCH: mocks.patch, POST: mocks.post, GET: mocks.get },
  unwrap: (p: Promise<unknown>) => p,
  ApiProblem: class extends Error { constructor(public status: number, public detail: string) { super(detail); } },
}));
vi.mock('../src/store', () => ({ useStore: {
  getState: () => ({ ...mocks.state, openProject: (project: unknown) => { mocks.state.project = project; } }),
  subscribe: vi.fn(),
} }));
vi.mock('../src/cloud/account', () => ({ isSignedIn: () => true, useAccount: { subscribe: vi.fn() } }));
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
