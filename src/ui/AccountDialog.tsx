import { useEffect, useMemo, useState } from 'react';
import { authClient, YOUTUBE_SCOPE } from '../api/auth';
import { api, unwrap, type Schemas } from '../api/client';
import { fontFamily, fontLabel } from '../assets';
import { resolveFont } from '../fonts';
import { useAccount } from '../cloud/account';
import { EMPTY_DEFAULTS, type Defaults } from '../cloud/defaults';
import { BUILTIN_PALETTES } from '../cloud/palettes';
import { SOCIAL_ICONS } from '../render/icons';
import { useStore } from '../store';
import { BUILTIN_FONTS, type SocialPlatform } from '../types';

export type AccountTab = 'profile' | 'billing' | 'defaults' | 'connections' | 'keys' | 'danger';

const TABS: [AccountTab, string][] = [
  ['profile', 'Profile'], ['billing', 'Billing'], ['defaults', 'Defaults'], ['connections', 'Connected accounts'], ['keys', 'API keys'], ['danger', 'Delete account'],
];

/** Account settings. Signed out, only the defaults tab is shown, saved in this browser. */
export function AccountDialog({ initialTab = 'profile', onClose }: { initialTab?: AccountTab; onClose: () => void }) {
  const signedIn = useAccount((s) => s.status === 'signed-in');
  const [selectedTab, setTab] = useState<AccountTab>(initialTab);
  const tab = signedIn ? selectedTab : 'defaults';
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal account" role="dialog" aria-labelledby="account-title">
        <h3 id="account-title">{signedIn ? 'Account' : 'Defaults'}</h3>
        {signedIn && (
          <div className="tabs account-tabs">
            {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
          </div>
        )}
        <div className="account-body">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'billing' && <BillingTab />}
          {tab === 'defaults' && <DefaultsTab />}
          {tab === 'connections' && <ConnectionsTab />}
          {tab === 'keys' && <KeysTab />}
          {tab === 'danger' && <DangerTab onDone={onClose} />}
        </div>
        <div className="buttons end"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function useStatus() {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ kind: 'ok', text: ok }); } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
  };
  const view = msg && <p className={msg.kind === 'err' ? 'warn' : 'hint'} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>;
  return { run, view };
}

// ---- profile ---------------------------------------------------------------------------------------------------
function ProfileTab() {
  const me = useAccount((s) => s.me)!;
  const refresh = useAccount((s) => s.refresh);
  const signOut = useAccount((s) => s.signOut);
  const [name, setName] = useState(me.name);
  const { run, view } = useStatus();
  return (
    <section className="form">
      <label className="field">Display name
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">Email
        <input value={me.email} readOnly />
        <span className="hint">{me.emailVerified ? 'Confirmed.' : 'Not confirmed yet. Check your inbox for the link.'}</span>
      </label>
      <p className="hint">Plan: <strong>{me.plan}</strong></p>
      {view}
      <div className="buttons">
        <button className="primary" disabled={name.trim() === me.name || !name.trim()}
          onClick={() => run(async () => { await unwrap(api.PATCH('/v1/me', { body: { name: name.trim() } })); await refresh(); }, 'Saved.')}>Save</button>
        <button onClick={() => void signOut()}>Sign out</button>
      </div>
    </section>
  );
}

// ---- defaults ------------------------------------------------------------------------------------------------------
const PLATFORMS = Object.keys(SOCIAL_ICONS) as SocialPlatform[];

function BillingTab() {
  const [billing, setBilling] = useState<Schemas['BillingStatus'] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useAccount((s) => s.refresh);
  const { run, view } = useStatus();
  const load = async () => {
    setBilling(await unwrap(api.GET('/v1/billing')));
    await refresh();
  };
  useEffect(() => { void run(load); }, []);
  const redirect = (action: 'checkout' | 'portal') => run(async () => {
    setBusy(true);
    try {
      const result = action === 'checkout' ? await unwrap(api.POST('/v1/billing/checkout')) : await unwrap(api.POST('/v1/billing/portal'));
      window.location.assign(result.url);
    } finally { setBusy(false); }
  });
  const price = billing?.amount != null ? new Intl.NumberFormat(undefined, { style: 'currency', currency: billing.currency }).format(billing.amount / 100) : null;
  return <section className="form">
    <p>Editing, templates and watermark-free exports on your device are free.</p>
    <p>Creator includes 120 cloud-rendered minutes per calendar month, up to 4K, 15 minutes per job and seven-day downloads. Unused minutes do not roll over.</p>
    {view}
    {!billing && <p className="hint">Loading billing…</p>}
    {billing && !billing.enabled && <p className="hint">Creator subscriptions are not available yet.</p>}
    {billing?.enabled && <>
      {billing.sandbox && <p className="warn">Sandbox billing. Use test payment details only. No real charges.</p>}
      <p>Creator: {price} per month. Automatically renews until cancelled.</p>
      <p className="hint">Subscription: {billing.status.replaceAll('_', ' ')}.</p>
      {billing.cancelAtPeriodEnd && billing.periodEnd && <p className="hint">Cancels on {new Date(billing.periodEnd).toLocaleDateString()}. Paid access remains until then.</p>}
      {!billing.creator && <p className="hint">After Checkout, refresh billing if payment confirmation is still pending.</p>}
      <div className="buttons">
        {billing.subscribed ? <button className="primary" disabled={busy} onClick={() => void redirect('portal')}>Manage subscription</button>
          : <button className="primary" disabled={busy} onClick={() => void redirect('checkout')}>Subscribe to Creator</button>}
        <button disabled={busy} onClick={() => void run(load)}>Refresh billing</button>
      </div>
    </>}
  </section>;
}

function DefaultsTab() {
  const saved = useAccount((s) => s.defaults);
  const save = useAccount((s) => s.saveDefaults);
  const signedIn = useAccount((s) => s.status === 'signed-in');
  // Select the stable assets object and filter outside the selector; a filtered array would be new on every render.
  const assets = useStore((s) => s.assets);
  const fonts = useMemo(() => Object.values(assets).filter((a) => a.meta.kind === 'font'), [assets]);
  const [d, setD] = useState<Defaults>({ ...EMPTY_DEFAULTS, ...saved });
  const { run, view } = useStatus();
  const set = (patch: Partial<Defaults>) => setD((x) => ({ ...x, ...patch }));
  const socials = d.socials;
  const setSocials = (next: Defaults['socials']) => set({ socials: next });

  return (
    <section className="form">
      <p className="hint">
        New projects from templates start with these. {signedIn ? 'Saved to your account, so they follow you to every device.' : 'Saved in this browser. Sign in to keep them in your account.'}
      </p>
      <label className="field">Artist name
        <input value={d.artistName} maxLength={120} placeholder="Shown in titles instead of “Artist”" onChange={(e) => set({ artistName: e.target.value })} />
      </label>
      <label className="field">Website
        <input value={d.website} maxLength={300} placeholder="https://" onChange={(e) => set({ website: e.target.value })} />
      </label>

      <div className="field">Socials
        <div className="socials">
          {socials.map((it, i) => (
            <div className="social-row" key={i}>
              <select value={it.platform} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, platform: e.target.value as SocialPlatform } : x)))}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{SOCIAL_ICONS[p].label}</option>)}
              </select>
              <input value={it.handle} placeholder="@handle" maxLength={120} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)))} />
              <button className="icon sm" aria-label="Remove" onClick={() => setSocials(socials.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {socials.length < 12 && <button className="sm" onClick={() => setSocials([...socials, { platform: 'instagram', handle: '' }])}>+ Add social</button>}
        </div>
      </div>

      <div className="field">Palette
        <div className="palettes">
          <button className={`palette-chip ${d.palette ? '' : 'active'}`} onClick={() => set({ palette: null })}>Keep template colours</button>
          {BUILTIN_PALETTES.map((p) => (
            <button key={p.id} className={`palette-chip ${JSON.stringify(d.palette) === JSON.stringify(p.colors) ? 'active' : ''}`} onClick={() => set({ palette: p.colors })}>
              <span className="swatches">{Object.values(p.colors).map((c) => <i key={c} style={{ background: c }} />)}</span>{p.name}
            </button>
          ))}
        </div>
        {d.palette && (
          <div className="palette-edit">
            {(Object.keys(d.palette) as (keyof NonNullable<Defaults['palette']>)[]).map((k) => (
              <label key={k} className="swatch-edit">
                <input type="color" value={d.palette![k].slice(0, 7)} onChange={(e) => set({ palette: { ...d.palette!, [k]: e.target.value } })} />
                <span className="hint">{k}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="field">Font
        <select value={resolveFont(d.font)} onChange={(e) => set({ font: e.target.value })}>
          <option value="">Keep template fonts</option>
          <optgroup label="Built in">{BUILTIN_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
          {fonts.length > 0 && <optgroup label="Uploaded on this device">{fonts.map((a) => <option key={a.meta.id} value={fontFamily(a.meta.id)}>{fontLabel(a)}</option>)}</optgroup>}
        </select>
        {d.font.startsWith(fontFamily('')) && <span className="hint">Uploaded fonts exist only on the device you uploaded them on.</span>}
      </label>

      <label className="check"><input type="checkbox" checked={d.applyToNewProjects} onChange={(e) => set({ applyToNewProjects: e.target.checked })} /> Apply to new projects automatically</label>
      {view}
      <div className="buttons">
        <button className="primary" onClick={() => run(() => save({ ...d, socials: d.socials.filter((s) => s.handle.trim()) }), 'Defaults saved.')}>Save defaults</button>
      </div>
    </section>
  );
}

// ---- connections ----------------------------------------------------------------------------------------------------------
interface LinkedAccount { id: string; providerId: string; accountId: string; scopes?: string[] }

function ConnectionsTab() {
  const providers = useAccount((s) => s.providers);
  const defaults = useAccount((s) => s.defaults);
  const saveDefaults = useAccount((s) => s.saveDefaults);
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const { run, view } = useStatus();
  const load = async () => setAccounts(((await authClient.listAccounts()).data ?? []) as LinkedAccount[]);
  useEffect(() => { void load(); }, []);

  const linked = (p: string) => accounts?.find((a) => a.providerId === p);
  const google = linked('google');
  const hasYouTube = !!google?.scopes?.some((s) => s.includes('youtube'));
  const link = (provider: 'google' | 'discord', scopes?: string[]) =>
    run(async () => {
      const { error } = await authClient.linkSocial({ provider, scopes, callbackURL: '/?account=connections' });
      if (error) throw new Error(error.message);
    });
  const unlink = (a: LinkedAccount) => run(async () => {
    const { error } = await authClient.unlinkAccount({ accountId: a.id });
    if (error) throw new Error(error.message ?? 'Could not disconnect.');
    await load();
  }, 'Disconnected.');
  const importSocials = (provider: 'google' | 'discord') => run(async () => {
    const res = await unwrap(api.POST('/v1/me/connections/{provider}/import', { params: { path: { provider } } }));
    const merged = [...defaults.socials.filter((s) => !res.socials.some((n) => n.platform === s.platform)), ...res.socials];
    await saveDefaults({ ...defaults, socials: merged });
  }, 'Added to your default socials.');

  const Row = ({ label, connected, detail, actions }: { label: string; connected: boolean; detail: string; actions: React.ReactNode }) => (
    <div className="connection">
      <div><strong>{label}</strong><span className="hint">{connected ? detail : 'Not connected'}</span></div>
      <div className="buttons">{actions}</div>
    </div>
  );

  if (!accounts) return <p className="hint">Loading…</p>;
  return (
    <section className="form">
      <p className="hint">Connect accounts to sign in with them and to fill your socials from your profiles.</p>
      {!providers.google && !providers.discord && <p className="warn">Google and Discord sign-in aren't configured on this server yet.</p>}
      {providers.google && (
        <>
          <Row label="Google" connected={!!google} detail="Connected. You can sign in with Google." actions={
            google ? <button className="sm" onClick={() => unlink(google)}>Disconnect</button> : <button className="sm" onClick={() => link('google')}>Connect</button>
          } />
          <Row label="YouTube" connected={hasYouTube} detail="Connected. Undertow can read your channel name." actions={
            hasYouTube
              ? <button className="sm" onClick={() => importSocials('google')}>Add channel to socials</button>
              : <button className="sm" onClick={() => link('google', [YOUTUBE_SCOPE])}>Connect YouTube</button>
          } />
        </>
      )}
      {providers.discord && (
        <Row label="Discord" connected={!!linked('discord')} detail="Connected. You can sign in with Discord." actions={
          linked('discord')
            ? <><button className="sm" onClick={() => importSocials('discord')}>Add to socials</button><button className="sm" onClick={() => unlink(linked('discord')!)}>Disconnect</button></>
            : <button className="sm" onClick={() => link('discord')}>Connect</button>
        } />
      )}
      {view}
    </section>
  );
}

// ---- API keys --------------------------------------------------------------------------------------------------------------------
type Key = Schemas['ApiKey'];

function KeysTab() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [usage, setUsage] = useState<Schemas['Usage'] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState('');
  const { run, view } = useStatus();
  const load = async () => {
    setKeys(await unwrap(api.GET('/v1/keys')));
    setUsage(await unwrap(api.GET('/v1/usage', { params: { query: { days: 30 } } })));
  };
  useEffect(() => { void run(load); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = usage?.days.reduce((s, d) => s + d.requests, 0) ?? 0;
  return (
    <section className="form">
      <p className="hint">API keys let scripts and other apps use your Undertow account. <a href="/docs" target="_blank" rel="noopener">API reference</a></p>
      {created && (
        <div className="support-nudge key-created">
          <p>Copy this key now. It won't be shown again.<br /><code>{created}</code></p>
          <button className="sm" onClick={() => void navigator.clipboard.writeText(created)}>Copy</button>
        </div>
      )}
      <ul className="key-list">
        {keys?.map((k) => (
          <li key={k.id}>
            <div><strong>{k.name ?? 'Unnamed key'}</strong> <code>{k.start}…</code>
              <span className="hint">Created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}{k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ''}</span>
            </div>
            <button className="sm danger" onClick={() => {
              if (confirm(`Revoke "${k.name ?? k.start}"? Anything using it stops working.`)) void run(async () => { await unwrap(api.DELETE('/v1/keys/{id}', { params: { path: { id: k.id } } })); await load(); }, 'Key revoked.');
            }}>Revoke</button>
          </li>
        ))}
        {keys?.length === 0 && <li className="hint">No keys yet.</li>}
      </ul>
      <div className="row">
        <input placeholder="Key name, e.g. Streaming PC" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()} onClick={() => run(async () => {
          const k = await unwrap(api.POST('/v1/keys', { body: { name: name.trim() } }));
          setCreated(k.key); setName(''); await load();
        })}>Create key</button>
      </div>
      {usage && (
        <p className="hint">
          {usage.plan} plan: {usage.limits.requestsPerMinute} requests a minute, {usage.limits.maxApiKeys} keys, {usage.limits.maxProjects} projects.
          {' '}{total} requests in the last 30 days.
        </p>
      )}
      {view}
    </section>
  );
}

// ---- delete ------------------------------------------------------------------------------------------------------------------------
function DangerTab({ onDone }: { onDone: () => void }) {
  const refresh = useAccount((s) => s.refresh);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const { run, view } = useStatus();
  return (
    <section className="form">
      <p>Deleting your account removes your saved projects, templates, palettes, defaults and API keys from Undertow. Files on your devices are not affected.</p>
      <label className="field">Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <span className="hint">If you only sign in with Google or Discord, leave this empty; you may be asked to sign in again first.</span>
      </label>
      <label className="field">Type DELETE to confirm
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </label>
      {view}
      <div className="buttons">
        <button className="danger" disabled={confirmText !== 'DELETE'} onClick={() => run(async () => {
          const { error } = await authClient.deleteUser(password ? { password } : {});
          if (error) throw new Error(error.message ?? 'Could not delete the account.');
          await refresh();
          onDone();
        })}>Delete my account</button>
      </div>
    </section>
  );
}
