import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { SkeletonBlock } from '@agendex/app/src/client/components/Skeleton.tsx';
import { PlanDiffViewer } from './PlanDiffViewer.tsx';

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sourceLabel(source?: string): string {
  switch (source) {
    case 'cli_sync':
      return 'CLI sync';
    case 'editor':
      return 'Edited';
    case 'restore':
      return 'Restored';
    default:
      return '';
  }
}

export function PlanHistoryDrawer({ planId, onClose }: { planId: string; onClose: () => void }) {
  const versions = useQuery(api.planVersions.listForPlan, { planId });
  const restoreMutation = useMutation(api.planVersions.restore);

  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (versions && versions.length >= 2 && compareFrom === null && compareTo === null) {
      setCompareFrom(versions[1].version);
      setCompareTo(versions[0].version);
    } else if (versions && versions.length === 1 && compareTo === null) {
      setCompareTo(versions[0].version);
    }
  }, [versions, compareFrom, compareTo]);

  const fromSnapshot = useQuery(
    api.planVersions.getVersion,
    compareFrom != null ? { planId, version: compareFrom } : 'skip',
  );
  const toSnapshot = useQuery(
    api.planVersions.getVersion,
    compareTo != null ? { planId, version: compareTo } : 'skip',
  );

  async function handleRestore() {
    if (compareFrom == null) return;
    const ok = window.confirm(
      `Restore to version ${compareFrom}? This will create a new version with that content.`,
    );
    if (!ok) return;
    setRestoring(true);
    try {
      await restoreMutation({ planId, version: compareFrom });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '40px 32px 80px' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3"
        style={{
          marginBottom: '28px',
          paddingBottom: '20px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '5px 10px',
            fontSize: '12.5px',
            fontWeight: 500,
            fontFamily: 'inherit',
            borderRadius: '7px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}
        >
          Version History
        </h2>
      </div>

      {/* Loading */}
      {versions === undefined ? (
        <SkeletonBlock lines={4} />
      ) : versions.length === 0 ? (
        /* Empty state */
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--tertiary)',
            fontSize: '13px',
          }}
        >
          <svg
            aria-hidden="true"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ margin: '0 auto 12px', opacity: 0.4 }}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
          <p style={{ fontWeight: 500, color: 'var(--secondary)', marginBottom: '4px' }}>
            No history yet
          </p>
          <p>History will appear after your next edit.</p>
        </div>
      ) : (
        <>
          {/* Version timeline */}
          <div style={{ marginBottom: '24px' }}>
            <h3
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
                marginBottom: '10px',
              }}
            >
              Versions
              <span
                style={{
                  marginLeft: '6px',
                  fontSize: '11.5px',
                  fontWeight: 450,
                  color: 'var(--tertiary)',
                }}
              >
                ({versions.length})
              </span>
            </h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              {versions.map((ver: any, idx: number) => (
                <button
                  type="button"
                  key={ver._id}
                  onClick={() => {
                    if (compareTo === ver.version) return;
                    setCompareFrom(compareTo ?? ver.version);
                    setCompareTo(ver.version);
                  }}
                  style={{
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 450,
                    fontFamily: 'inherit',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background:
                      compareFrom === ver.version || compareTo === ver.version
                        ? 'var(--hover)'
                        : 'transparent',
                    color:
                      compareFrom === ver.version || compareTo === ver.version
                        ? 'var(--text)'
                        : 'var(--secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span style={{ fontWeight: 550 }}>v{ver.version}</span>
                  <span style={{ fontSize: '11px', color: 'var(--tertiary)' }}>
                    {timeAgo(ver.createdAt)}
                  </span>
                  {ver.source && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 500,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(100,116,139,0.08)',
                        color: 'var(--tertiary)',
                      }}
                    >
                      {sourceLabel(ver.source)}
                    </span>
                  )}
                  {idx === 0 && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(59,130,246,0.10)',
                        color: '#3b82f6',
                      }}
                    >
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Compare controls */}
          {versions.length >= 2 && (
            <div
              className="flex items-center gap-3"
              style={{
                marginBottom: '20px',
                flexWrap: 'wrap',
              }}
            >
              <div className="flex items-center gap-2">
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--secondary)' }}>
                  From
                </label>
                <select
                  value={compareFrom ?? ''}
                  onChange={(e) => setCompareFrom(Number(e.target.value))}
                  style={{
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {versions.map((ver: any) => (
                    <option key={ver._id} value={ver.version}>
                      v{ver.version} — {timeAgo(ver.createdAt)}
                    </option>
                  ))}
                </select>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--tertiary)' }}>→</span>
              <div className="flex items-center gap-2">
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--secondary)' }}>
                  To
                </label>
                <select
                  value={compareTo ?? ''}
                  onChange={(e) => setCompareTo(Number(e.target.value))}
                  style={{
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {versions.map((ver: any) => (
                    <option key={ver._id} value={ver.version}>
                      v{ver.version} — {timeAgo(ver.createdAt)}
                    </option>
                  ))}
                </select>
              </div>
              {compareFrom != null && (
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoring}
                  style={{
                    marginLeft: 'auto',
                    padding: '5px 14px',
                    fontSize: '12.5px',
                    fontWeight: 550,
                    fontFamily: 'inherit',
                    borderRadius: '7px',
                    border: 'none',
                    background: 'var(--text)',
                    color: 'var(--bg)',
                    cursor: restoring ? 'not-allowed' : 'pointer',
                    opacity: restoring ? 0.5 : 1,
                  }}
                >
                  {restoring ? 'Restoring…' : `Restore v${compareFrom}`}
                </button>
              )}
            </div>
          )}

          {/* Diff viewer */}
          {compareFrom != null && compareTo != null ? (
            fromSnapshot === undefined || toSnapshot === undefined ? (
              <SkeletonBlock lines={6} />
            ) : (
              <PlanDiffViewer oldContent={fromSnapshot.content} newContent={toSnapshot.content} />
            )
          ) : compareTo != null && versions.length === 1 ? (
            toSnapshot === undefined ? (
              <SkeletonBlock lines={6} />
            ) : (
              <div
                style={{
                  padding: '16px',
                  fontSize: '12.5px',
                  color: 'var(--tertiary)',
                  textAlign: 'center',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              >
                Only one version available. Make another edit to compare versions.
              </div>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
