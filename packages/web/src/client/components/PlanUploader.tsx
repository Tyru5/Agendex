import { useCallback, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { type AgentStats, api, type Plan } from '../lib/api.ts';
import { planMarkdownComponents, planMarkdownRemarkPlugins } from './markdownRenderConfig.tsx';

interface UploadFile {
  name: string;
  title: string;
  content: string;
}

type Step = 'pick' | 'confirm';

function extractTitle(text: string, filename: string): string {
  const match = text.match(/^#\s+(.+)/m);
  if (match?.[1]) return match[1].trim();
  return filename.replace(/\.md$/i, '');
}

function formatSize(chars: number) {
  return chars > 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
}

function readFile(file: File): Promise<UploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      resolve({ name: file.name, title: extractTitle(text, file.name), content: text });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

export function PlanUploader({
  agents,
  onClose,
  onCreated,
}: {
  agents: AgentStats[];
  onClose: () => void;
  onCreated: (plan: Plan) => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [agent, setAgent] = useState(() => agents[0]?.agent ?? '');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList) => {
    const mdFiles = Array.from(fileList).filter((f) => f.name.endsWith('.md'));
    if (mdFiles.length === 0) {
      setError('Only .md files are supported');
      return;
    }
    setError(undefined);
    const parsed = await Promise.all(mdFiles.map(readFile));
    setFiles(parsed);
    setPreviewIdx(0);
    setStep('confirm');
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
  }

  function updateFileTitle(idx: number, title: string) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, title } : f)));
  }

  function removeFile(idx: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) {
        setStep('pick');
        return [];
      }
      return next;
    });
    setPreviewIdx((prev) => Math.min(prev, files.length - 2));
  }

  async function handleUpload() {
    const valid = files.filter((f) => f.title.trim() && f.content.trim());
    if (valid.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setError(undefined);

    let firstPlan: Plan | undefined;
    try {
      for (let i = 0; i < valid.length; i++) {
        const f = valid[i]!;
        const plan = await api.createPlan(agent, f.title.trim(), f.content.trim());
        if (i === 0) firstPlan = plan;
        setUploadProgress(() => i + 1);
      }
      if (firstPlan) onCreated(firstPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const previewFile = files[previewIdx];
  const canUpload = !uploading && files.some((f) => f.title.trim() && f.content.trim());

  if (step === 'pick') {
    return (
      <div className="upload-view">
        <div className="upload-noise" />

        <div className="upload-content">
          {/* dropzone requires div for drag/drop */}
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
          <div
            role="button"
            tabIndex={0}
            className={`upload-dropzone${dragOver ? ' upload-dropzone-active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
          >
            <div className="upload-dropzone-ring">
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.4}
                stroke="currentColor"
                className="upload-dropzone-icon"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </div>

            <span className="upload-dropzone-label">
              {dragOver ? 'Release to upload' : 'Drop .md files here or click to browse'}
            </span>

            <span className="upload-dropzone-hint">One or multiple markdown files</span>

            <input
              ref={inputRef}
              type="file"
              accept=".md"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
          </div>
          {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}

          {error && <div className="upload-error">{error}</div>}

          <button type="button" onClick={onClose} className="upload-cancel-link">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col upload-confirm-enter">
      {/* Header */}
      <div className="upload-confirm-header">
        <div className="upload-confirm-header-left">
          <div className="upload-file-chip">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.6}
              stroke="currentColor"
              className="w-[13px] h-[13px] shrink-0"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
            <span className="upload-file-chip-name">
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </span>
          </div>

          <div className="upload-config-field">
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="upload-config-select"
            >
              {agents.map((a) => (
                <option key={a.agent} value={a.agent}>
                  {getAgentLabel(a.agent)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
          <button
            type="button"
            onClick={() => {
              setStep('pick');
              setFiles([]);
              setError(undefined);
            }}
            className="upload-btn-ghost"
          >
            Back
          </button>
          <button type="button" onClick={onClose} className="upload-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className="upload-btn-primary"
          >
            {uploading
              ? `Uploading ${uploadProgress}/${files.length}...`
              : files.length === 1
                ? 'Upload'
                : `Upload ${files.length} files`}
          </button>
        </div>
      </div>

      {/* Body: file list + preview */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* File list */}
        <div className="upload-file-list">
          {files.map((f, i) => {
            const lines = f.content.split('\n').length;
            return (
              <div
                role="option"
                aria-selected={i === previewIdx}
                tabIndex={0}
                key={`${f.name}-${i}`}
                className={`upload-file-row${i === previewIdx ? ' upload-file-row-active' : ''}`}
                onClick={() => setPreviewIdx(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setPreviewIdx(i);
                }}
              >
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={f.title}
                    onChange={(e) => updateFileTitle(i, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="upload-file-row-title"
                    placeholder="Plan title..."
                  />
                  <div className="upload-file-row-meta">
                    {f.name} &middot; {lines} lines &middot; {formatSize(f.content.length)} chars
                  </div>
                </div>
                {files.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    className="upload-file-row-remove"
                    aria-label="Remove file"
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="w-3 h-3"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto px-8 py-6">
          {previewFile ? (
            <article className="plan-markdown">
              <Markdown
                remarkPlugins={planMarkdownRemarkPlugins}
                components={planMarkdownComponents}
              >
                {previewFile.content}
              </Markdown>
            </article>
          ) : (
            <div className="h-full flex items-center justify-center text-[13px] text-tertiary">
              Select a file to preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
