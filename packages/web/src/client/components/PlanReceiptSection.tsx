import { commitUrl } from '@agendex/shared/git-forge';
import { type PlanReceipt, summarizePlanReceipt } from '@agendex/shared/receipts';
import { useId, useState } from 'react';
import {
  formatReceiptCounts,
  RECEIPT_CONFIDENCE_LABEL,
  RECEIPT_STATUS_LABEL,
  receiptUnavailableMessage,
} from '../lib/plan-receipt-format.ts';
import { timeAgo } from '../lib/time-ago.ts';
import type { PlanPathOpenResult } from './PlanPathContext.tsx';
import { ReceiptStatusIcon } from './ReceiptStatusIcon.tsx';

type FileGroup = { key: keyof PlanReceipt['files']; label: string; openable: boolean };

const FILE_GROUPS: FileGroup[] = [
  { key: 'changed', label: 'Changed as planned', openable: true },
  { key: 'uncommitted', label: 'Uncommitted', openable: true },
  { key: 'untouched', label: 'Not touched yet', openable: true },
  { key: 'unplanned', label: 'Changed outside the plan', openable: true },
  { key: 'missing', label: 'Missing', openable: false },
];

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="plan-receipt-chevron"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function ReceiptFile({
  path,
  repoRoot,
  onOpenPath,
}: {
  path: string;
  repoRoot: string | undefined;
  onOpenPath: ((path: string) => Promise<PlanPathOpenResult>) | undefined;
}) {
  const [error, setError] = useState<string>();
  if (!onOpenPath) {
    return (
      <li className="plan-receipt-file">
        <code>{path}</code>
      </li>
    );
  }
  // Receipt paths are repo-relative; the open flow checks absolute paths against the workspace.
  const target = repoRoot ? `${repoRoot.replace(/[\\/]+$/, '')}/${path}` : path;
  return (
    <li className="plan-receipt-file">
      <button
        type="button"
        className="plan-receipt-file-open"
        title={`Open ${path}`}
        onClick={async () => {
          setError(undefined);
          const result = await onOpenPath(target);
          if (!result.ok) setError(result.error ?? 'Could not open this file');
        }}
      >
        <code>{path}</code>
      </button>
      {error && <span className="plan-receipt-file-error">{error}</span>}
    </li>
  );
}

function ReceiptDetail({
  receipt,
  onOpenPath,
}: {
  receipt: PlanReceipt;
  onOpenPath: ((path: string) => Promise<PlanPathOpenResult>) | undefined;
}) {
  const branch = receipt.defaultBranch?.replace(/^origin\//, '');
  return (
    <>
      {receipt.reasons.length > 0 && (
        <ul className="plan-receipt-reasons">
          {receipt.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {receipt.commits.length > 0 && (
        <div className="plan-receipt-group">
          <h3 className="plan-receipt-group-title">
            Commits <span>{receipt.commits.length + receipt.omittedCommitCount}</span>
          </h3>
          <ol className="plan-receipt-commits">
            {receipt.commits.map((commit) => {
              const url = commitUrl(receipt.repo, commit.sha);
              const body = (
                <>
                  <code className="plan-receipt-sha">{commit.sha.slice(0, 7)}</code>
                  <span className="plan-receipt-commit-subject">{commit.subject}</span>
                </>
              );
              return (
                <li key={commit.sha} className="plan-receipt-commit">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="plan-receipt-commit-body plan-receipt-commit-link"
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="plan-receipt-commit-body">{body}</span>
                  )}
                  <span className="plan-receipt-commit-meta">
                    <time dateTime={commit.committedAt} title={commit.authorName}>
                      {timeAgo(commit.committedAt)}
                    </time>
                    {commit.onDefaultBranch && (
                      <span className="plan-receipt-on-branch">On {branch ?? 'main'}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {receipt.omittedCommitCount > 0 && (
            <p className="plan-receipt-more">
              {receipt.omittedCommitCount} older commit
              {receipt.omittedCommitCount === 1 ? '' : 's'} not shown
            </p>
          )}
        </div>
      )}

      {FILE_GROUPS.map(({ key, label, openable }) => {
        const files = receipt.files[key];
        if (files.length === 0) return null;
        return (
          <div key={key} className="plan-receipt-group">
            <h3 className="plan-receipt-group-title">
              {label} <span>{files.length}</span>
            </h3>
            <ul className="plan-receipt-files">
              {files.map((path) => (
                <ReceiptFile
                  key={path}
                  path={path}
                  repoRoot={receipt.repoRoot}
                  onOpenPath={openable ? onOpenPath : undefined}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function PlanReceiptSection({
  receipt,
  loading = false,
  onOpenPath,
}: {
  receipt: PlanReceipt | null | undefined;
  loading?: boolean;
  /** Opens a local file through the plan's open-in flow; omitted when unavailable. */
  onOpenPath?: (path: string) => Promise<PlanPathOpenResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();

  if (!receipt) {
    return loading ? (
      <p className="plan-receipt-quiet" aria-busy="true">
        Checking git history…
      </p>
    ) : null;
  }

  if (receipt.status === 'unavailable') {
    const message = receiptUnavailableMessage(receipt.unavailableReason);
    return message ? <p className="plan-receipt-quiet">{message}</p> : null;
  }

  const summary = summarizePlanReceipt(receipt);
  const timing = receipt.landedAt
    ? `Landed ${timeAgo(receipt.landedAt)}`
    : receipt.lastActivityAt
      ? `Last commit ${timeAgo(receipt.lastActivityAt)}`
      : undefined;
  const meta = [
    receipt.confidence && RECEIPT_CONFIDENCE_LABEL[receipt.confidence],
    formatReceiptCounts(summary),
    timing,
  ].filter(Boolean);

  return (
    <section className="plan-receipt" data-status={receipt.status} aria-label="Plan receipt">
      <button
        type="button"
        className="plan-receipt-summary"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronIcon />
        <span className="plan-receipt-title">Receipt</span>
        <span className="plan-receipt-status">
          <ReceiptStatusIcon status={receipt.status} />
          {RECEIPT_STATUS_LABEL[receipt.status]}
        </span>
        <span className="plan-receipt-meta">{meta.join(' · ')}</span>
      </button>
      <div id={detailId} className="plan-receipt-detail" hidden={!expanded}>
        {expanded && <ReceiptDetail receipt={receipt} onOpenPath={onOpenPath} />}
      </div>
    </section>
  );
}
