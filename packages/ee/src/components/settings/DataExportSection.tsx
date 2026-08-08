import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[20px] font-semibold text-text mb-4">{children}</h2>;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DataExportSection() {
  const exportStatus = useQuery(api.dataExport.getMyDataExport, {});
  const requestExport = useMutation(api.dataExport.requestDataExport);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaitingExportId = useRef<string | null>(null);
  const downloadedExportId = useRef<string | null>(null);

  const status = exportStatus?.status;
  const inFlight = status === 'pending' || status === 'building' || requesting;
  const ready = status === 'ready' && !!exportStatus?.downloadUrl;
  const failed = status === 'failed';

  useEffect(() => {
    if (!exportStatus || exportStatus.status !== 'ready' || !exportStatus.downloadUrl) return;
    if (awaitingExportId.current !== exportStatus.exportId) return;
    if (downloadedExportId.current === exportStatus.exportId) return;

    downloadedExportId.current = exportStatus.exportId;
    awaitingExportId.current = null;
    triggerDownload(exportStatus.downloadUrl, exportStatus.fileName ?? 'agendex-export.zip');
    setRequesting(false);
  }, [exportStatus]);

  useEffect(() => {
    if (exportStatus?.status === 'failed' && awaitingExportId.current === exportStatus.exportId) {
      awaitingExportId.current = null;
      setRequesting(false);
    }
  }, [exportStatus]);

  async function startExport() {
    if (inFlight) return;
    setRequesting(true);
    setError(null);
    downloadedExportId.current = null;
    try {
      const { exportId } = await requestExport({});
      awaitingExportId.current = exportId;
    } catch (err) {
      setRequesting(false);
      setError(err instanceof Error ? err.message : 'Unable to start data export. Try again.');
    }
  }

  function downloadReady() {
    if (!exportStatus?.downloadUrl) return;
    triggerDownload(exportStatus.downloadUrl, exportStatus.fileName ?? 'agendex-export.zip');
  }

  const sizeLabel = formatBytes(exportStatus?.byteSize ?? null);
  let helperText =
    'Creates a ZIP of your cloud account data (plans, versions, comments, attachments, preferences, and more). OAuth tokens and share-link password hashes are omitted.';
  if (inFlight && !ready) {
    helperText = 'Preparing your archive. This can take a minute for large accounts…';
  } else if (ready) {
    helperText = sizeLabel
      ? `Your latest export is ready (${sizeLabel}). Downloads expire after 7 days.`
      : 'Your latest export is ready. Downloads expire after 7 days.';
  } else if (failed) {
    helperText = exportStatus?.error
      ? `Last export failed: ${exportStatus.error}`
      : 'Last export failed. Try again.';
  }

  return (
    <section>
      <SectionHeading>Your data</SectionHeading>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-text">Download my data</div>
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-secondary">
              {helperText}
            </p>
            {error && (
              <div className="mt-2 text-[12px] text-red-400" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
            {ready ? (
              <>
                <button
                  type="button"
                  onClick={downloadReady}
                  className="text-[13px] px-3.5 py-1.5 rounded-xl border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover"
                >
                  Download ZIP
                </button>
                <button
                  type="button"
                  onClick={() => void startExport()}
                  disabled={inFlight}
                  className="text-[12px] px-2 py-1 rounded-lg border-0 bg-transparent text-secondary cursor-pointer hover:text-text disabled:opacity-50 disabled:cursor-default"
                >
                  Generate new export
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void startExport()}
                disabled={inFlight}
                className="text-[13px] px-3.5 py-1.5 rounded-xl border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-50 disabled:cursor-default"
              >
                {inFlight ? 'Preparing…' : failed ? 'Retry export' : 'Download my data'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
