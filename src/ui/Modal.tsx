import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react';

/**
 * Every dialog in the editor. A native <dialog> opened with showModal(), so
 * focus moves in and stays in, the page behind is inert, Escape closes it and
 * focus returns to whatever opened it. The <dialog> fills the viewport and is
 * its own backdrop; clicking outside the box closes it.
 *
 * `locked` holds it open while work that shouldn't be abandoned is running.
 * With `onSubmit` the box is a <form>.
 */
export function Modal({ className = '', labelledBy, onClose, locked = false, onSubmit, children }: {
  className?: string; labelledBy: string; onClose: () => void; locked?: boolean;
  onSubmit?: (e: FormEvent) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: close() has to run before React removes the element, or focus isn't handed back.
  useLayoutEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  const Box = onSubmit ? 'form' : 'div';
  return (
    <dialog ref={ref} className="modal-back" aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); if (!locked) onClose(); }}
      onPointerDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <Box className={`modal ${className}`} onSubmit={onSubmit}>{children}</Box>
    </dialog>
  );
}
