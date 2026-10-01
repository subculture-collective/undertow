import { useAccount } from '../cloud/account';
import type { AccountTab } from './AccountDialog';
import { Menu } from './Menu';

/** "Sign in" when signed out; an account menu with the user's initial when signed in. */
export function AccountButton({ onSignIn, onAccount, onProjects, onRenders }: {
  onSignIn: () => void; onAccount: (tab: AccountTab) => void; onProjects: () => void; onRenders: () => void;
}) {
  const { status, me, signOut } = useAccount();
  if (status === 'unknown') return <span className="account-placeholder" aria-hidden="true" />;
  if (status === 'signed-out' || !me) return <button onClick={onSignIn}>Sign in</button>;
  const initial = (me.name || me.email).trim().charAt(0).toUpperCase();
  return (
    <Menu label={<span className="avatar" title={`${me.name} (${me.email})`}>{me.image ? <img src={me.image} alt="" /> : initial}</span>}>
      <div className="menu-head"><strong>{me.name}</strong><span className="hint">{me.email}</span></div>
      <button onClick={onProjects}>Projects…</button>
      <button onClick={onRenders}>Cloud renders…</button>
      <button onClick={() => onAccount('billing')}>Billing…</button>
      <button onClick={() => onAccount('defaults')}>Defaults…</button>
      <button onClick={() => onAccount('connections')}>Connected accounts…</button>
      <button onClick={() => onAccount('keys')}>API keys…</button>
      <button onClick={() => onAccount('profile')}>Account settings…</button>
      <button onClick={() => void signOut()}>Sign out</button>
    </Menu>
  );
}
