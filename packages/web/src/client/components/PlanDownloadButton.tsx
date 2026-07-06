import { useEffect, useId, useRef, useState } from 'react';
import type { Plan } from '../lib/api.ts';
import { downloadPlan, type PlanDownloadFormat } from '../lib/plan-download.ts';
import { PlanActionButton } from './PlanActionButton.tsx';

const DOWNLOAD_FORMAT_OPTIONS: readonly {
  readonly format: PlanDownloadFormat;
  readonly label: string;
}[] = [
  { format: 'md', label: 'Markdown (.md)' },
  { format: 'html', label: 'HTML (.html)' },
  { format: 'pdf', label: 'PDF (.pdf)' },
];

function DownloadPlanIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 15.75v2.25A2.25 2.25 0 0 0 6 20.25h12A2.25 2.25 0 0 0 20.25 18v-2.25M7.5 10.5 12 15m0 0 4.5-4.5M12 15V3.75"
      />
    </svg>
  );
}

function downloadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to download this plan.';
}

export function PlanDownloadButton({ plan }: { readonly plan: Plan }) {
  const menuId = useId();
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeMenu() {
      setOpen(false);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target)) return;
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError(null);
  }, [open]);

  function handleFormatClick(format: PlanDownloadFormat) {
    try {
      downloadPlan(plan, format);
      setOpen(false);
    } catch (downloadError) {
      setError(downloadErrorMessage(downloadError));
    }
  }

  return (
    <span ref={menuRef} className="plan-download-action" data-open={open ? 'true' : undefined}>
      <PlanActionButton
        label="Download plan"
        tooltip="Download plan"
        controls={menuId}
        expanded={open}
        hasPopup="menu"
        pressed={open}
        onClick={() => {
          setError(null);
          setOpen((current) => !current);
        }}
      >
        <DownloadPlanIcon />
      </PlanActionButton>
      {open && (
        <span id={menuId} className="plan-download-menu" role="menu" aria-label="Download plan">
          {DOWNLOAD_FORMAT_OPTIONS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="plan-download-menu-item"
              onClick={() => handleFormatClick(format)}
            >
              {label}
            </button>
          ))}
          {error && (
            <output className="plan-download-menu-status" aria-live="polite">
              {error}
            </output>
          )}
        </span>
      )}
    </span>
  );
}
