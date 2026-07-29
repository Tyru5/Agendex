import { type FormEvent, useEffect, useRef, useState } from 'react';

export type PlanGitChipKind = 'repo' | 'branch' | 'commit' | 'pr';

export interface PlanGitChip {
  key: string;
  kind: PlanGitChipKind;
  label: string;
  url?: string;
  title?: string;
  /** Detected from the synced workspace (vs manually linked). */
  detected?: boolean;
  onRemove?: () => void;
}

export interface PlanGitSectionProps {
  chips: PlanGitChip[];
  /**
   * Attach a new link from free-form input (branch name, commit SHA, PR
   * number, or URL). Resolve to an error message to display, or null on success.
   */
  onAddLink?: (input: string) => Promise<string | null>;
}

function RepoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
    </svg>
  );
}

function PullRequestIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function ExternalLinkHint() {
  return (
    <svg
      aria-hidden="true"
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="plan-git-chip-external"
    >
      <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />
    </svg>
  );
}

function chipIcon(kind: PlanGitChipKind) {
  switch (kind) {
    case 'repo':
      return <RepoIcon />;
    case 'branch':
      return <BranchIcon />;
    case 'commit':
      return <CommitIcon />;
    case 'pr':
      return <PullRequestIcon />;
  }
}

function GitChip({ chip }: { chip: PlanGitChip }) {
  const body = (
    <>
      {chipIcon(chip.kind)}
      <span className="plan-git-chip-label">{chip.label}</span>
      {chip.url && <ExternalLinkHint />}
    </>
  );

  return (
    <span
      className={`plan-git-chip${chip.detected ? ' plan-git-chip--detected' : ''}`}
      title={chip.title}
    >
      {chip.url ? (
        <a href={chip.url} target="_blank" rel="noopener noreferrer" className="plan-git-chip-link">
          {body}
        </a>
      ) : (
        <span className="plan-git-chip-link plan-git-chip-link--static">{body}</span>
      )}
      {chip.onRemove && (
        <button
          type="button"
          className="plan-git-chip-remove"
          title="Remove link"
          aria-label={`Remove ${chip.label}`}
          onClick={(event) => {
            event.stopPropagation();
            chip.onRemove?.();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function AddLinkPopover({
  onAddLink,
  onClose,
}: {
  onAddLink: (input: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const failure = await onAddLink(input);
      if (failure) {
        setError(failure);
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={containerRef} className="plan-git-popover" role="dialog" aria-label="Link git">
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            if (error) setError('');
          }}
          placeholder="Branch, commit SHA, #PR, or URL"
          className="plan-git-popover-input"
          aria-label="Branch, commit SHA, PR number, or URL"
        />
        {error && (
          <p className="plan-git-popover-error" role="alert">
            {error}
          </p>
        )}
        <div className="plan-git-popover-actions">
          <button
            type="submit"
            className="plan-git-popover-submit"
            disabled={submitting || !input.trim()}
          >
            {submitting ? 'Linking…' : 'Link'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Chips row connecting a plan to the git branch, commits, and PR that
 * implemented it. Purely presentational: callers resolve chips (detected
 * workspace context + stored links) and persistence.
 */
export function PlanGitSection({ chips, onAddLink }: PlanGitSectionProps) {
  const [showAdd, setShowAdd] = useState(false);

  if (chips.length === 0 && !onAddLink) return null;

  return (
    <div className="plan-git-section" aria-label="Git links">
      {chips.map((chip) => (
        <GitChip key={chip.key} chip={chip} />
      ))}
      {onAddLink && (
        <div className="relative">
          <button
            type="button"
            className="plan-tags-action"
            title="Link a branch, commit, or PR"
            onClick={() => setShowAdd((value) => !value)}
          >
            <BranchIcon />
            Link git
          </button>
          {showAdd && <AddLinkPopover onAddLink={onAddLink} onClose={() => setShowAdd(false)} />}
        </div>
      )}
    </div>
  );
}
