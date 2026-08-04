import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PathExistsApiResult } from '../lib/api.ts';
import { parseCodePath, type ParsedCodePath } from '../lib/plan-paths.ts';
import { type PlanPathContextValue, usePlanPathContext } from './PlanPathContext.tsx';

export const PLAN_PATH_OPEN_EVENT = 'agendex-path-open';
export const PLAN_PATH_COPY_EVENT = 'agendex-path-copy';

type AnchorPos = { top: number; left: number };

/**
 * Inline-code renderer gate: validated paths become openable links,
 * everything else stays plain code.
 */
export function PlanPathCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const context = usePlanPathContext();
  const text = String(children);
  const parsed = context ? parseCodePath(text) : null;
  const result = context && parsed ? context.results[parsed.path] : undefined;

  if (
    !context ||
    !parsed ||
    !result ||
    (result.status !== 'found' && result.status !== 'ambiguous')
  ) {
    return <code className={className}>{children}</code>;
  }

  return (
    <PlanPathLink context={context} parsed={parsed} result={result} display={text}>
      {children}
    </PlanPathLink>
  );
}

function PlanPathLink({
  context,
  parsed,
  result,
  display,
  children,
}: {
  context: PlanPathContextValue;
  parsed: ParsedCodePath;
  result: PathExistsApiResult;
  display: string;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<AnchorPos | null>(null);
  const [errorPos, setErrorPos] = useState<AnchorPos | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);

  const isFound = result.status === 'found';
  const openTarget = isFound ? result.relative : parsed.path;

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimeoutRef.current !== null) window.clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = window.setTimeout(() => {
      errorTimeoutRef.current = null;
      setError(null);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current !== null) window.clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  const openWithApp = useCallback(
    async (path: string, appId?: string) => {
      setMenuOpen(false);
      const outcome = await context.openPath(path, parsed.line, appId);
      if (!outcome.ok) showError(outcome.error ?? 'Failed to open path');
    },
    [context, parsed.line, showError],
  );

  const handlePrimary = useCallback(() => {
    if (isFound) {
      void openWithApp(openTarget);
      return;
    }
    setMenuOpen((open) => !open);
  }, [isFound, openTarget, openWithApp]);

  const copyPath = useCallback(async () => {
    setMenuOpen(false);
    const value = result.status === 'found' ? result.resolved : parsed.path;
    await navigator.clipboard.writeText(value);
  }, [parsed.path, result]);

  // Keyboard navigation dispatches events on the focused path node.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onOpen = () => handlePrimary();
    const onCopy = () => void copyPath();
    root.addEventListener(PLAN_PATH_OPEN_EVENT, onOpen);
    root.addEventListener(PLAN_PATH_COPY_EVENT, onCopy);
    return () => {
      root.removeEventListener(PLAN_PATH_OPEN_EVENT, onOpen);
      root.removeEventListener(PLAN_PATH_COPY_EVENT, onCopy);
    };
  }, [copyPath, handlePrimary]);

  useLayoutEffect(() => {
    if (!menuOpen && !error) {
      setMenuPos(null);
      setErrorPos(null);
      return;
    }

    const place = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const preferredTop = rect.bottom + 4;
      const left = Math.min(rect.left, window.innerWidth - 180);

      if (menuOpen) {
        const menuHeight = menuRef.current?.offsetHeight ?? 0;
        const fitsBelow = preferredTop + menuHeight <= window.innerHeight - 8;
        const top =
          fitsBelow || menuHeight === 0 ? preferredTop : Math.max(8, rect.top - menuHeight - 4);
        setMenuPos({ top, left: Math.max(8, left) });
      }

      if (error) {
        setErrorPos({ top: preferredTop, left: Math.max(8, left) });
      }
    };

    place();
    // Re-measure after paint once the menu has a real height for flip-above.
    const frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen, error]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onDismiss = () => setMenuOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [menuOpen]);

  const preferredLabel =
    context.apps.find((app) => app.id === context.preferredAppId)?.label ?? 'default app';

  const menu = menuOpen
    ? createPortal(
        <span
          ref={menuRef}
          className="plan-path-menu plan-path-menu--portal"
          role="menu"
          style={{
            top: menuPos?.top ?? 0,
            left: menuPos?.left ?? 0,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
        >
          {result.status === 'ambiguous' ? (
            <>
              <span className="plan-path-menu-heading">Matches in workspace</span>
              {result.matches.map((match) => (
                <button
                  key={match}
                  type="button"
                  role="menuitem"
                  onClick={() => void openWithApp(match)}
                >
                  {match}
                </button>
              ))}
            </>
          ) : (
            <>
              {context.apps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  role="menuitem"
                  onClick={() => void openWithApp(openTarget, app.id)}
                >
                  {app.label}
                  {app.id === context.preferredAppId && (
                    <span className="plan-path-menu-hint">last used</span>
                  )}
                </button>
              ))}
            </>
          )}
          <button type="button" role="menuitem" onClick={() => void copyPath()}>
            Copy path
          </button>
        </span>,
        document.body,
      )
    : null;

  const errorToast = error
    ? createPortal(
        <span
          className="plan-path-error plan-path-error--portal"
          role="alert"
          style={{
            top: errorPos?.top ?? 0,
            left: errorPos?.left ?? 0,
            visibility: errorPos ? 'visible' : 'hidden',
          }}
        >
          {error}
        </span>,
        document.body,
      )
    : null;

  return (
    <span
      ref={rootRef}
      className="plan-path"
      data-agendex-path={parsed.path}
      data-path-status={result.status}
    >
      <button
        type="button"
        className="plan-path-open"
        onClick={handlePrimary}
        title={
          isFound
            ? `Open in ${preferredLabel}${parsed.line ? ` at line ${parsed.line}` : ''}`
            : `${result.status === 'ambiguous' ? result.matches.length : 0} matches in workspace`
        }
      >
        <code>{children ?? display}</code>
        {result.status === 'ambiguous' && (
          <span className="plan-path-badge" aria-label="Multiple matches">
            {result.matches.length}
          </span>
        )}
      </button>
      {isFound && (
        <button
          type="button"
          className="plan-path-more"
          aria-label="Open with…"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ChevronIcon />
        </button>
      )}
      {menu}
      {errorToast}
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[9px] h-[9px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
