import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { useSocketEvent } from '../hooks/useSocket.ts';
import { HiddenPlansPanel } from './HiddenPlansPanel.tsx';

/** Remains reachable even when every locally indexed plan is hidden. */
export function HiddenPlansRecoveryButton() {
  const [total, setTotal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(() => {
    void api
      .getHiddenPlans()
      .then((response) => setTotal(response.hiddenCount))
      .catch(() => setTotal(null));
  }, []);
  useSocketEvent('plan:updated', refresh);
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('agendex:visibility-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('agendex:visibility-changed', refresh);
    };
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
      opener?.focus();
    };
  }, [open]);
  return (
    <>
      <button className="hidden-plans-recovery-button" type="button" onClick={() => setOpen(true)}>
        Hidden plans{total === null ? '' : ` (${total})`}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="hidden-plans-dialog"
          onCancel={() => setOpen(false)}
          aria-label="Hidden plan recovery"
        >
          <button
            type="button"
            className="hidden-plans-close"
            onClick={() => setOpen(false)}
            autoFocus
          >
            Close recovery
          </button>
          <HiddenPlansPanel
            onChanged={() => {
              refresh();
              window.dispatchEvent(new Event('agendex:visibility-changed'));
            }}
          />
        </dialog>
      )}
    </>
  );
}
