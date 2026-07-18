import { useEffect, useMemo, useRef } from 'react';

export const FOCUS_PLAN_SEARCH_EVENT = 'agendex:focus-plan-search';

export function focusPlanSearchField() {
  window.dispatchEvent(new Event(FOCUS_PLAN_SEARCH_EVENT));
}

export function PlanSearchField({
  search,
  onSearch,
  onFocusRequest,
}: {
  search: string;
  onSearch: (value: string) => void;
  onFocusRequest?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = useShortcutLabel();

  useEffect(() => {
    function focusInput() {
      onFocusRequest?.();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusInput();
      }
    }

    window.addEventListener(FOCUS_PLAN_SEARCH_EVENT, focusInput);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(FOCUS_PLAN_SEARCH_EVENT, focusInput);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onFocusRequest]);

  return (
    <div className="sidebar-control-block">
      <div className="sidebar-control-header">
        <span className="sidebar-control-label">Search</span>
        <kbd className="sidebar-shortcut-key">{shortcutLabel}</kbd>
      </div>
      <div className="sidebar-search-shell">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="sidebar-search-input"
          placeholder="Search plans"
          aria-label="Search plans"
        />
        {search.trim().length > 0 && (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => {
              onSearch('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            title="Clear search"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function useShortcutLabel() {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return 'Mod K';
    return /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  }, []);
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-3.5 h-3.5 text-tertiary"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
