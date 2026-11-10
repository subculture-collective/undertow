import { create } from 'zustand';
import { byCodeUnit } from './render/presetPool';

const KEY = 'undertow:milkdrop-favourites';

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].sort(byCodeUnit) : [];
  } catch { return []; }
}

interface Favourites {
  /** Starred Milkdrop preset names in this browser, sorted. */
  names: string[];
  /** Stars or unstars a preset; returns whether it is now starred. */
  toggle: (name: string) => boolean;
}

export const useFavourites = create<Favourites>((set, get) => ({
  names: load(),
  toggle: (name) => {
    const s = new Set(get().names);
    const starred = !s.delete(name);
    if (starred) s.add(name);
    const names = [...s].sort(byCodeUnit);
    try { localStorage.setItem(KEY, JSON.stringify(names)); } catch { /* storage full or blocked: keep them for this session */ }
    set({ names });
    return starred;
  },
}));

// Another tab starred something: pick it up here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) useFavourites.setState({ names: load() }); });
}
