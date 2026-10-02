import { useState } from 'react';
import { create } from 'zustand';
import { Modal } from './Modal';

/**
 * Confirm, rename and notice dialogs in the editor's own style, in place of
 * the browser's confirm(), prompt() and alert(). Each returns a promise, so
 * callers read the same way: `if (await confirmAsk({...})) ...`.
 */
interface Ask {
  kind: 'confirm' | 'prompt' | 'notice';
  title: string;
  body?: string;
  /** Label of the button that goes ahead. */
  action?: string;
  danger?: boolean;
  /** Prompt only: the field's label and starting value. */
  label?: string;
  value?: string;
  resolve: (v: string | boolean | null) => void;
}

const useAsk = create<{ current: Ask | null }>(() => ({ current: null }));

const open = <T extends string | boolean | null>(a: Omit<Ask, 'resolve'>) =>
  new Promise<T>((resolve) => useAsk.setState({ current: { ...a, resolve: resolve as Ask['resolve'] } }));

export const confirmAsk = (a: { title: string; body?: string; action: string; danger?: boolean }) => open<boolean>({ kind: 'confirm', ...a });
export const promptAsk = (a: { title: string; label: string; value?: string; action: string }) => open<string | null>({ kind: 'prompt', ...a });
export const noticeAsk = (a: { title: string; body?: string }) => open<boolean>({ kind: 'notice', ...a });

/** Rendered once, in App. Shows whichever question is waiting. */
export function AskHost() {
  const ask = useAsk((s) => s.current);
  return ask ? <AskDialog key={ask.title} ask={ask} /> : null;
}

function AskDialog({ ask }: { ask: Ask }) {
  const [value, setValue] = useState(ask.value ?? '');
  const done = (v: string | boolean | null) => { useAsk.setState({ current: null }); ask.resolve(v); };
  const cancel = () => done(ask.kind === 'prompt' ? null : false);
  return (
    <Modal className="ask" labelledBy="ask-title" onClose={cancel}
      onSubmit={(e) => { e.preventDefault(); done(ask.kind === 'prompt' ? value.trim() || null : true); }}>
      <h3 id="ask-title">{ask.title}</h3>
      {ask.body && <p>{ask.body}</p>}
      {ask.kind === 'prompt' && (
        <label className="field">{ask.label}
          <input value={value} maxLength={120} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      <div className="buttons end">
        {ask.kind !== 'notice' && <button type="button" onClick={cancel}>Cancel</button>}
        <button type="submit" className={ask.danger ? 'danger' : 'primary'}>
          {ask.kind === 'notice' ? 'OK' : ask.action}
        </button>
      </div>
    </Modal>
  );
}
