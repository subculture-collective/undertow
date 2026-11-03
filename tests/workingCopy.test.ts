import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { starterProject } from '../src/defaults';

const storage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), map: m };
};
let local: ReturnType<typeof storage>;
let wc: typeof import('../src/workingCopy');
beforeEach(async () => {
  vi.resetModules();
  local = storage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', storage());
  wc = await import('../src/workingCopy');
});
afterEach(() => vi.unstubAllGlobals());

it('keeps each tab paired with its own layout and revision across a reload', async () => {
  const stale = { ...starterProject(), name: 'B stale' };
  wc.writeWorkingCopy({ project: stale, ref: { source: 'cloud', id: 'X', revision: 5 } });
  // Another tab saves revision 6 later; it writes the shared copy but not this tab's.
  local.setItem('undertow:working-copy', JSON.stringify({ project: { ...starterProject(), name: 'A' }, ref: { source: 'cloud', id: 'X', revision: 6 } }));
  const restored = wc.readWorkingCopy()!;
  expect(restored.project.name).toBe('B stale');
  expect(restored.ref).toEqual({ source: 'cloud', id: 'X', revision: 5 });
});

it('opens the most recent copy in a new tab, still paired', async () => {
  local.setItem('undertow:working-copy', JSON.stringify({ project: { ...starterProject(), name: 'A' }, ref: { source: 'cloud', id: 'X', revision: 6 } }));
  expect(wc.readWorkingCopy()).toMatchObject({ project: { name: 'A' }, ref: { id: 'X', revision: 6 } });
});

it('migrates the older separate keys and then removes them', () => {
  local.setItem('vizstudio:project', JSON.stringify({ ...starterProject(), name: 'Old' }));
  local.setItem('undertow:doc', JSON.stringify({ source: 'local', id: 'loc_1' }));
  const old = wc.readWorkingCopy()!;
  expect(old).toMatchObject({ project: { name: 'Old' }, ref: { source: 'local', id: 'loc_1' } });
  wc.writeWorkingCopy(old);
  expect(local.map.has('vizstudio:project')).toBe(false);
  expect(local.map.has('undertow:doc')).toBe(false);
});

it('drops an unreadable layout together with its reference', () => {
  local.setItem('undertow:working-copy', JSON.stringify({ project: { name: 'x' }, ref: { source: 'cloud', id: 'X', revision: 1 } }));
  expect(wc.readWorkingCopy()).toBeNull();
});
