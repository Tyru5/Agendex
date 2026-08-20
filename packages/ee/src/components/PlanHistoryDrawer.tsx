import { SkeletonBlock } from '@agendex/web';
import { decryptPlanBody, decryptPlanSummary, encryptPlanWrite } from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { timeAgo } from '../lib/formatTime.ts';
import { useWorkspaceCryptoStatus } from '../hooks/useCloudMetadataCrypto.ts';
import { withWorkspaceKey } from '../lib/obfuscation-keyring.ts';
import { PlanDiffViewer } from './PlanDiffViewer.tsx';

function sourceLabel(source?: string): string {
  switch (source) {
    case 'cli_sync':
      return 'CLI sync';
    case 'editor':
      return 'Edited';
    case 'restore':
      return 'Restored';
    case 'backfill':
      return 'Initial snapshot';
    default:
      return '';
  }
}

export function PlanHistoryDrawer({ planId, onClose }: { planId: string; onClose: () => void }) {
  const versions = useQuery(api.planVersions.listForPlan, { planId: planId as Id<'plans'> });
  const planCryptoRecord = useQuery(api.plans.getPlanCryptoRecord, {
    planId: planId as Id<'plans'>,
  });
  const cryptoStatus = useWorkspaceCryptoStatus();
  const restoreMutation = useMutation(api.planVersions.restore);

  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const newest = versions?.[0];
    const previous = versions?.[1];
    if (versions && versions.length >= 2 && compareFrom === null && compareTo === null) {
      if (previous && newest) {
        setCompareFrom(previous.version);
        setCompareTo(newest.version);
      }
    } else if (versions?.length === 1 && compareTo === null && newest) {
      setCompareTo(newest.version);
    }
  }, [versions, compareFrom, compareTo]);

  const fromSnapshot = useQuery(
    api.planVersions.getVersion,
    compareFrom != null ? { planId: planId as Id<'plans'>, version: compareFrom } : 'skip',
  );
  const toSnapshot = useQuery(
    api.planVersions.getVersion,
    compareTo != null ? { planId: planId as Id<'plans'>, version: compareTo } : 'skip',
  );

  const readableVersions = useMemo(
    () =>
      versions?.map((version) => {
        if (
          !version.encryptedSummary ||
          !version.stableCryptoId ||
          !version.keyEpoch ||
          !cryptoStatus?.workspaceOwnerId
        ) {
          return version;
        }
        const { encryptedSummary, stableCryptoId, keyEpoch } = version;
        const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
        try {
          const summary = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
            decryptPlanSummary({
              workspaceKey,
              workspaceOwnerId,
              stableCryptoId,
              keyEpoch,
              envelope: encryptedSummary,
              table: 'planVersions',
            }),
          );
          return { ...version, title: summary.title };
        } catch {
          return { ...version, title: 'Locked version' };
        }
      }),
    [cryptoStatus, versions],
  );

  const decryptSnapshot = useCallback(
    (snapshot: typeof fromSnapshot) => {
      if (
        !snapshot?.encryptedSummary ||
        !snapshot.encryptedBody ||
        !snapshot.stableCryptoId ||
        !snapshot.keyEpoch ||
        !cryptoStatus?.workspaceOwnerId
      ) {
        return snapshot;
      }
      const { encryptedSummary, encryptedBody, stableCryptoId, keyEpoch } = snapshot;
      const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
      try {
        return withWorkspaceKey(workspaceOwnerId, (workspaceKey) => {
          const summary = decryptPlanSummary({
            workspaceKey,
            workspaceOwnerId,
            stableCryptoId,
            keyEpoch,
            envelope: encryptedSummary,
            table: 'planVersions',
          });
          const content = decryptPlanBody({
            workspaceKey,
            workspaceOwnerId,
            stableCryptoId,
            keyEpoch,
            envelope: encryptedBody,
            table: 'planVersions',
          });
          return { ...snapshot, ...summary, content };
        });
      } catch {
        return undefined;
      }
    },
    [cryptoStatus],
  );

  const readableFromSnapshot = useMemo(
    () => decryptSnapshot(fromSnapshot),
    [decryptSnapshot, fromSnapshot],
  );
  const readableToSnapshot = useMemo(
    () => decryptSnapshot(toSnapshot),
    [decryptSnapshot, toSnapshot],
  );

  async function handleRestore() {
    if (compareFrom == null) return;
    const ok = window.confirm(
      `Restore to version ${compareFrom}? This will create a new version with that content.`,
    );
    if (!ok) return;
    setRestoring(true);
    try {
      if (cryptoStatus?.settings && planCryptoRecord?.stableCryptoId && readableFromSnapshot) {
        const { workspaceOwnerId, settings } = cryptoStatus;
        const stableCryptoId = planCryptoRecord.stableCryptoId;
        const encrypted = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
          encryptPlanWrite({
            workspaceKey,
            workspaceOwnerId,
            keyEpoch: settings.activeKeyEpoch,
            stableCryptoId,
            plan: {
              localPlanId:
                'localPlanId' in readableFromSnapshot &&
                typeof readableFromSnapshot.localPlanId === 'string'
                  ? readableFromSnapshot.localPlanId
                  : '',
              agent: planCryptoRecord.agent,
              title: readableFromSnapshot.title,
              content: readableFromSnapshot.content,
              format: readableFromSnapshot.format,
              filePath: readableFromSnapshot.filePath,
              workspace: readableFromSnapshot.workspace,
              metadata: readableFromSnapshot.metadata,
              lowValue: planCryptoRecord.lowValue,
            },
          }),
        );
        await restoreMutation({
          planId: planId as Id<'plans'>,
          version: compareFrom,
          clientCryptoProtocol: 1,
          keyEpoch: encrypted.keyEpoch,
          encryptedSummary: encrypted.encryptedSummary,
          encryptedBody: encrypted.encryptedBody,
          versionStableCryptoId: encrypted.versionStableCryptoId,
          encryptedVersionSummary: encrypted.encryptedVersionSummary,
          encryptedVersionBody: encrypted.encryptedVersionBody,
          contentToken: encrypted.contentToken,
          lowValue: encrypted.lowValue,
        });
      } else {
        await restoreMutation({ planId: planId as Id<'plans'>, version: compareFrom });
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="max-w-[780px] mx-auto px-8 pt-10 pb-20">
      <div className="flex items-center gap-3 mb-7 pb-5 border-b border-border">
        <button
          type="button"
          onClick={onClose}
          className="py-[5px] px-2.5 text-[12.5px] font-medium font-[inherit] rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer flex items-center gap-1"
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
        <h2 className="text-[15px] font-semibold text-text tracking-[0]">Version History</h2>
      </div>

      {versions === undefined ? (
        <SkeletonBlock lines={4} />
      ) : versions.length === 0 ? (
        <div className="py-10 px-5 text-center text-tertiary text-[13px]">
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
            className="mx-auto mb-3 opacity-40"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
          <p className="font-medium text-secondary mb-1">No history yet</p>
          <p>Edits and CLI syncs will appear here as versions.</p>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h3 className="text-[13px] font-semibold text-text tracking-[0] mb-2.5">
              Versions
              <span className="ml-1.5 text-[11.5px] font-[450] text-tertiary">
                ({versions.length})
              </span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {readableVersions?.map((ver, idx) => (
                <button
                  type="button"
                  key={ver._id}
                  onClick={() => {
                    if (compareTo === ver.version) return;
                    setCompareFrom(compareTo ?? ver.version);
                    setCompareTo(ver.version);
                  }}
                  className="py-[5px] px-2.5 text-[12px] font-[450] font-[inherit] rounded-[6px] border border-border cursor-pointer flex items-center gap-1.5"
                  style={{
                    background:
                      compareFrom === ver.version || compareTo === ver.version
                        ? 'var(--hover)'
                        : 'transparent',
                    color:
                      compareFrom === ver.version || compareTo === ver.version
                        ? 'var(--text)'
                        : 'var(--secondary)',
                  }}
                >
                  <span className="font-[550]">v{ver.version}</span>
                  <span className="text-[11px] text-tertiary">{timeAgo(ver.createdAt)}</span>
                  {ver.source && (
                    <span className="text-[10px] font-medium py-px px-[5px] rounded-[4px] bg-[rgba(100,116,139,0.08)] text-tertiary">
                      {sourceLabel(ver.source)}
                    </span>
                  )}
                  {idx === 0 && (
                    <span className="text-[10px] font-semibold py-px px-[5px] rounded-[4px] bg-[var(--accent-soft)] text-[var(--accent)]">
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {versions.length >= 2 && (
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="history-compare-from"
                  className="text-[12px] font-medium text-secondary"
                >
                  From
                </label>
                <select
                  id="history-compare-from"
                  value={compareFrom ?? ''}
                  onChange={(e) => setCompareFrom(Number(e.target.value))}
                  className="py-1 px-2 text-[12px] font-[inherit] rounded-[6px] border border-border bg-transparent text-text cursor-pointer"
                >
                  {readableVersions?.map((ver) => (
                    <option key={ver._id} value={ver.version}>
                      v{ver.version} — {timeAgo(ver.createdAt)}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-[12px] text-tertiary">→</span>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="history-compare-to"
                  className="text-[12px] font-medium text-secondary"
                >
                  To
                </label>
                <select
                  id="history-compare-to"
                  value={compareTo ?? ''}
                  onChange={(e) => setCompareTo(Number(e.target.value))}
                  className="py-1 px-2 text-[12px] font-[inherit] rounded-[6px] border border-border bg-transparent text-text cursor-pointer"
                >
                  {readableVersions?.map((ver) => (
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
                  className="ml-auto py-[5px] px-3.5 text-[12.5px] font-[550] font-[inherit] rounded-[7px] border-none bg-text text-bg"
                  style={{
                    cursor: restoring ? 'not-allowed' : 'pointer',
                    opacity: restoring ? 0.5 : 1,
                  }}
                >
                  {restoring ? 'Restoring…' : `Restore v${compareFrom}`}
                </button>
              )}
            </div>
          )}

          {compareFrom != null && compareTo != null ? (
            readableFromSnapshot === undefined || readableToSnapshot === undefined ? (
              <SkeletonBlock lines={6} />
            ) : (
              <PlanDiffViewer
                oldContent={readableFromSnapshot.content}
                newContent={readableToSnapshot.content}
                oldLabel={`v${compareFrom}`}
                newLabel={`v${compareTo}`}
                oldTitle={readableFromSnapshot.title}
                newTitle={readableToSnapshot.title}
              />
            )
          ) : compareTo != null && versions.length === 1 ? (
            readableToSnapshot === undefined ? (
              <SkeletonBlock lines={6} />
            ) : (
              <div className="p-4 text-[12.5px] text-tertiary text-center border border-border rounded-lg">
                Only one version available. Make another edit to compare versions.
              </div>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
