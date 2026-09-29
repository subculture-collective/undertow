import { create } from 'zustand';
import { authClient } from '../api/auth';
import { api, unwrap, type Schemas } from '../api/client';
import { hasDefaults, loadLocalDefaults, saveLocalDefaults, type Defaults } from './defaults';

export type Me = Schemas['Me'];

interface AccountState {
  /** 'unknown' until the first session check finishes, so the UI doesn't flash "Sign in". */
  status: 'unknown' | 'signed-out' | 'signed-in';
  me: Me | null;
  /** The defaults in effect: the account's when signed in, this browser's otherwise. */
  defaults: Defaults;
  providers: { google: boolean; discord: boolean };
  /** Set when the API can't be reached; the editor keeps working on this device. */
  offline: boolean;

  refresh: () => Promise<void>;
  saveDefaults: (d: Defaults) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAccount = create<AccountState>((set, get) => ({
  status: 'unknown',
  me: null,
  defaults: loadLocalDefaults(),
  providers: { google: false, discord: false },
  offline: false,

  refresh: async () => {
    try {
      const meta = await unwrap(api.GET('/v1/meta'));
      set({ providers: meta.providers, offline: false });
    } catch {
      set({ status: 'signed-out', offline: true });
      return;
    }
    const session = await authClient.getSession().catch(() => null);
    if (!session?.data) {
      set({ status: 'signed-out', me: null, defaults: loadLocalDefaults() });
      return;
    }
    let me = await unwrap(api.GET('/v1/me'));
    // First sign-in from this browser: carry over defaults set while signed out.
    const local = loadLocalDefaults();
    if (!hasDefaults(me.defaults) && hasDefaults(local)) {
      const saved = await unwrap(api.PUT('/v1/me/defaults', { body: local }));
      me = { ...me, defaults: saved };
    }
    set({ status: 'signed-in', me, defaults: me.defaults });
  },

  saveDefaults: async (d) => {
    if (get().status === 'signed-in') {
      const saved = await unwrap(api.PUT('/v1/me/defaults', { body: d }));
      set((s) => ({ defaults: saved, me: s.me && { ...s.me, defaults: saved } }));
    } else {
      saveLocalDefaults(d);
      set({ defaults: d });
    }
  },

  signOut: async () => {
    await authClient.signOut();
    set({ status: 'signed-out', me: null, defaults: loadLocalDefaults() });
  },
}));

export const isSignedIn = () => useAccount.getState().status === 'signed-in';
