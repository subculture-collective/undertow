import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A dropdown built on <details>. It closes when you pick an item, click
 * anywhere outside it, or press Escape.
 */
export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open');
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) { close(); ref.current.querySelector('summary')?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details className="menu" ref={ref}>
      <summary>{label}</summary>
      {/* Any button inside closes the menu after it runs. */}
      <div onClick={(e) => { if ((e.target as Element).closest('button')) ref.current?.removeAttribute('open'); }}>
        {children}
      </div>
    </details>
  );
}
