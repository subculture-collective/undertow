import { useState, type FormEvent } from 'react';
import { authClient } from '../api/auth';
import { BRAND } from '../brand';
import { useAccount } from '../cloud/account';
import { SOCIAL_ICONS } from '../render/icons';
import { BrandMark, LegalLinks } from './Brand';
import { Modal } from './Modal';

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'check-email';

const GOOGLE_PATH = 'M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.02 1.08-2.62 2.2-5.53 2.2-4.42 0-7.89-3.57-7.89-8s3.47-8 7.89-8c2.39 0 4.13.94 5.42 2.14l2.31-2.31C18.84 2.4 16.07 1 12.48 1 6.1 1 .96 6.14.96 12.5S6.1 24 12.48 24c3.45 0 6.05-1.13 8.09-3.25 2.09-2.09 2.74-5.03 2.74-7.4 0-.73-.06-1.43-.18-2.08z';

function Provider({ id, label, path }: { id: 'google' | 'discord'; label: string; path: string }) {
  return (
    <button type="button" className="provider" onClick={() => authClient.signIn.social({ provider: id, callbackURL: '/', errorCallbackURL: '/?auth-error=1' })}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d={path} /></svg>
      Continue with {label}
    </button>
  );
}

/**
 * Sign in, create an account, and reset a password. `resetToken` comes from
 * the link in a password-reset email.
 */
export function AuthDialog({ initial = 'sign-in', resetToken, onClose }: { initial?: AuthMode; resetToken?: string; onClose: () => void }) {
  const providers = useAccount((s) => s.providers);
  const refresh = useAccount((s) => s.refresh);
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (fn: () => Promise<{ error: { message?: string; code?: string } | null }>) => {
    setBusy(true); setError('');
    try {
      const { error: e } = await fn();
      if (e) { setError(e.code === 'EMAIL_NOT_VERIFIED' ? 'Confirm your email first. We sent you a link when you signed up.' : e.message ?? 'That didn’t go through. Try again.'); return false; }
      return true;
    } catch {
      setError(`Could not reach ${BRAND.name}. Check your connection.`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'sign-in') {
      if (await run(() => authClient.signIn.email({ email, password }))) { await refresh(); onClose(); }
    } else if (mode === 'sign-up') {
      if (await run(() => authClient.signUp.email({ name: name || email.split('@')[0], email, password, callbackURL: '/?verified=1' }))) setMode('check-email');
    } else if (mode === 'forgot') {
      if (await run(() => authClient.requestPasswordReset({ email, redirectTo: '/' }))) {
        setNotice(`If ${email} has an account, a reset link is on its way.`);
      }
    } else if (mode === 'reset' && resetToken) {
      if (await run(() => authClient.resetPassword({ newPassword: password, token: resetToken }))) {
        setNotice('Password changed. Sign in with your new password.');
        setPassword('');
        setMode('sign-in');
        history.replaceState(null, '', '/');
      }
    }
  };

  const title = { 'sign-in': 'Sign in', 'sign-up': 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password', 'check-email': 'Check your email' }[mode];
  const anyProvider = providers.google || providers.discord;

  return (
    <Modal className="auth" labelledBy="auth-title" onClose={onClose} locked={busy} onSubmit={submit}>
      <div className="auth-head">
        <BrandMark size={36} />
        <h3 id="auth-title">{title}</h3>
      </div>

      {mode === 'check-email' ? (
        <>
          <p>We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.</p>
          <p className="hint">Nothing arrived? Check spam, or sign up again to resend.</p>
          <div className="buttons end"><button type="button" className="primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <>
          {(mode === 'sign-in' || mode === 'sign-up') && anyProvider && (
            <>
              <div className="providers">
                {providers.google && <Provider id="google" label="Google" path={GOOGLE_PATH} />}
                {providers.discord && <Provider id="discord" label="Discord" path={SOCIAL_ICONS.discord.path} />}
              </div>
              <div className="or"><span>or with email</span></div>
            </>
          )}
          {mode === 'sign-up' && (
            <label className="field">Artist or display name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={120} />
            </label>
          )}
          {mode !== 'reset' && (
            <label className="field">Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
          )}
          {mode !== 'forgot' && (
            <label className="field">{mode === 'reset' ? 'New password' : 'Password'}
              <input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} />
              {mode !== 'sign-in' && <span className="hint">At least 10 characters.</span>}
            </label>
          )}
          {error && <p className="warn" role="alert">{error}</p>}
          {notice && <p className="hint" role="status">{notice}</p>}
          <div className="buttons end">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Working…' : { 'sign-in': 'Sign in', 'sign-up': 'Create account', forgot: 'Send reset link', reset: 'Save password' }[mode]}
            </button>
          </div>
          <p className="hint auth-switch">
            {mode === 'sign-in' && <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('sign-up'); setError(''); }}>Create an account</a> · <a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); setError(''); }}>Forgot password?</a></>}
            {mode === 'sign-up' && <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('sign-in'); setError(''); }}>Sign in</a></>}
            {mode === 'forgot' && <a href="#" onClick={(e) => { e.preventDefault(); setMode('sign-in'); setNotice(''); }}>Back to sign in</a>}
          </p>
          {mode === 'sign-up' && <p className="hint">Your account saves project layouts and defaults. Songs, images, clips and fonts stay on your devices.</p>}
          {mode === 'sign-up' && <LegalLinks />}
        </>
      )}
    </Modal>
  );
}
