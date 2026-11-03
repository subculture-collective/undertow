/**
 * The working copy: the open project as last edited, stored together with the
 * document it belongs to and the revision its edits are based on. Keeping them
 * in one record means a reload can never pair one tab's layout with another
 * tab's revision, which would let a stale layout pass the server's conflict
 * check and overwrite newer edits.
 *
 * Each tab keeps its own copy in sessionStorage, which survives a reload of that
 * tab. localStorage holds the most recent copy from any tab, so a new tab or the
 * next session reopens where you left off.
 */
import { toProject } from './projectShape';
import type { Project } from './types';

export type Source = 'local' | 'cloud';
export interface DocRef { source: Source; id: string; revision?: number }
export interface WorkingCopy { project: Project; ref: DocRef | null }

const KEY = 'undertow:working-copy';
// Before the combined record, the layout and the document reference were stored separately.
const LEGACY_PROJECT = 'vizstudio:project';
const LEGACY_REF = 'undertow:doc';

const storages = (): Storage[] => {
  const out: Storage[] = [];
  for (const get of [() => sessionStorage, () => localStorage]) {
    try { const s = get(); if (s) out.push(s); } catch { /* unavailable: private mode, sandbox or tests */ }
  }
  return out;
};

const isRef = (r: unknown): r is DocRef => typeof r === 'object' && r !== null
  && ((r as DocRef).source === 'local' || (r as DocRef).source === 'cloud') && typeof (r as DocRef).id === 'string';

function parse(raw: string | null): WorkingCopy | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as { project?: unknown; ref?: unknown };
    const project = toProject(rec.project);
    // A layout that can't be read is dropped together with its reference.
    return project ? { project, ref: isRef(rec.ref) ? rec.ref : null } : null;
  } catch { return null; }
}

let initial: { value: WorkingCopy | null } | null = null;
/** The record this page started from, read once so the editor and the document code agree on it. */
export function initialWorkingCopy(): WorkingCopy | null {
  initial ??= { value: readWorkingCopy() };
  return initial.value;
}

export function readWorkingCopy(): WorkingCopy | null {
  for (const s of storages()) {
    try {
      const wc = parse(s.getItem(KEY));
      if (wc) return wc;
    } catch { /* try the next storage */ }
  }
  try {
    const project = toProject(JSON.parse(localStorage.getItem(LEGACY_PROJECT) ?? 'null'));
    if (!project) return null;
    const ref = JSON.parse(localStorage.getItem(LEGACY_REF) ?? 'null') as unknown;
    return { project, ref: isRef(ref) ? ref : null };
  } catch { return null; }
}

export function writeWorkingCopy(wc: WorkingCopy) {
  const raw = JSON.stringify(wc);
  for (const s of storages()) {
    try { s.setItem(KEY, raw); } catch { /* full or unavailable; the other storage may still work */ }
  }
  try {
    if (localStorage.getItem(KEY) === raw) { localStorage.removeItem(LEGACY_PROJECT); localStorage.removeItem(LEGACY_REF); }
  } catch { /* keep the legacy keys */ }
}
