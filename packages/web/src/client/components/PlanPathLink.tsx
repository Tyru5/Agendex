import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { PathExistsApiResult } from '../lib/api.ts';
import { parseCodePath, type ParsedCodePath } from '../lib/plan-paths.ts';
import { type PlanPathContextValue, usePlanPathContext } from './PlanPathContext.tsx';

export const PLAN_PATH_OPEN_EVENT = 'agendex-path-open';
export const PLAN_PATH_COPY_EVENT = 'agendex-path-copy';

type AnchorPos = { top: number; left: number };
type OpenablePathResult = Extract<
  PathExistsApiResult,
  { status: 'found' } | { status: 'ambiguous' }
>;

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
  result: OpenablePathResult;
  display: string;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
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

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }
  }, []);

  const toggleMenuFrom = useCallback((trigger: HTMLButtonElement | null) => {
    returnFocusRef.current = trigger;
    setMenuOpen((open) => !open);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current !== null) window.clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  const openWithApp = useCallback(
    async (path: string, appId?: string) => {
      closeMenu(true);
      const outcome = await context.openPath(path, parsed.line, appId);
      if (!outcome.ok) showError(outcome.error ?? 'Failed to open path');
    },
    [closeMenu, context, parsed.line, showError],
  );

  const handlePrimary = useCallback(() => {
    if (isFound) {
      void openWithApp(openTarget);
      return;
    }
    toggleMenuFrom(primaryRef.current);
  }, [isFound, openTarget, openWithApp, toggleMenuFrom]);

  const copyPath = useCallback(async () => {
    closeMenu(true);
    const value = result.status === 'found' ? result.resolved : parsed.path;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      showError('Could not copy the path. Check browser clipboard permissions.');
    }
  }, [closeMenu, parsed.path, result, showError]);

  const openFromPathEvent = useEffectEvent(handlePrimary);
  const copyFromPathEvent = useEffectEvent(() => void copyPath());

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

  // Keyboard navigation dispatches events on the focused path node.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onOpen = () => openFromPathEvent();
    const onCopy = () => copyFromPathEvent();
    root.addEventListener(PLAN_PATH_OPEN_EVENT, onOpen);
    root.addEventListener(PLAN_PATH_COPY_EVENT, onCopy);
    return () => {
      root.removeEventListener(PLAN_PATH_OPEN_EVENT, onOpen);
      root.removeEventListener(PLAN_PATH_COPY_EVENT, onCopy);
    };
  }, []);

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
      closeMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    const onDismiss = () => closeMenu(false);
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
  }, [closeMenu, menuOpen]);

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowUp'
            ? (current - 1 + items.length) % items.length
            : (current + 1) % items.length;
    items[nextIndex]?.focus();
  }, []);

  const preferredLabel =
    context.apps.find((app) => app.id === context.preferredAppId)?.label ?? 'default app';

  return (
    <span
      ref={rootRef}
      className="plan-path"
      data-agendex-path={parsed.path}
      data-path-status={result.status}
    >
      <button
        ref={primaryRef}
        type="button"
        className="plan-path-open"
        onClick={handlePrimary}
        aria-haspopup={isFound ? undefined : 'menu'}
        aria-controls={!isFound && menuOpen ? menuId : undefined}
        aria-expanded={isFound ? undefined : menuOpen}
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
          ref={moreRef}
          type="button"
          className="plan-path-more"
          aria-label="Open with…"
          aria-haspopup="menu"
          aria-controls={menuOpen ? menuId : undefined}
          aria-expanded={menuOpen}
          onClick={() => toggleMenuFrom(moreRef.current)}
        >
          <ChevronIcon />
        </button>
      )}
      {menuOpen && (
        <PlanPathMenu
          menuRef={menuRef}
          menuId={menuId}
          position={menuPos}
          result={result}
          context={context}
          openTarget={openTarget}
          onKeyDown={handleMenuKeyDown}
          onOpen={openWithApp}
          onCopy={copyPath}
        />
      )}
      {error && <PlanPathError message={error} position={errorPos} />}
    </span>
  );
}

function PlanPathMenu({
  menuRef,
  menuId,
  position,
  result,
  context,
  openTarget,
  onKeyDown,
  onOpen,
  onCopy,
}: {
  menuRef: RefObject<HTMLSpanElement | null>;
  menuId: string;
  position: AnchorPos | null;
  result: OpenablePathResult;
  context: PlanPathContextValue;
  openTarget: string;
  onKeyDown: (event: ReactKeyboardEvent<HTMLSpanElement>) => void;
  onOpen: (path: string, appId?: string) => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  return createPortal(
    <span
      ref={menuRef}
      id={menuId}
      className="plan-path-menu plan-path-menu--portal"
      role="menu"
      tabIndex={-1}
      aria-label="Open source path"
      onKeyDown={onKeyDown}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {result.status === 'ambiguous' ? (
        <>
          <span className="plan-path-menu-heading">Matches in workspace</span>
          {result.matches.map((match) => (
            <button key={match} type="button" role="menuitem" onClick={() => void onOpen(match)}>
              {match}
            </button>
          ))}
        </>
      ) : (
        context.apps.map((app) => (
          <button
            key={app.id}
            type="button"
            role="menuitem"
            onClick={() => void onOpen(openTarget, app.id)}
          >
            {app.label}
            {app.id === context.preferredAppId && (
              <span className="plan-path-menu-hint">last used</span>
            )}
          </button>
        ))
      )}
      <button type="button" role="menuitem" onClick={() => void onCopy()}>
        Copy path
      </button>
    </span>,
    document.body,
  );
}

function PlanPathError({ message, position }: { message: string; position: AnchorPos | null }) {
  return createPortal(
    <span
      className="plan-path-error plan-path-error--portal"
      role="status"
      aria-live="polite"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {message}
    </span>,
    document.body,
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
