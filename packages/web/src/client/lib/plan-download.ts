import type { Plan } from './api.ts';

export type PlanDownloadFormat = 'md' | 'html' | 'pdf';

type PlanDownloadInput = Pick<Plan, 'agent' | 'content' | 'filePath' | 'title' | 'updatedAt'>;

type DirectPlanDownload = {
  readonly content: string;
  readonly filename: string;
  readonly mimeType: string;
};

const MAX_FILENAME_STEM_LENGTH = 90;
const FALLBACK_PLAN_NAME = 'agendex-plan';
const INVALID_FILENAME_CHARS = '<>:"/\\|?*';
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const PLAN_DOWNLOAD_EXTENSIONS = {
  md: 'md',
  html: 'html',
  pdf: 'pdf',
} as const satisfies Record<PlanDownloadFormat, string>;

function assertNever(value: never): never {
  throw new Error(`Unsupported plan download format: ${String(value)}`);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function filenameStemFromPath(filePath: string): string {
  const normalizedPath = filePath.trim().replace(/[\\/]+$/g, '');
  const pathParts = normalizedPath.split(/[\\/]+/);
  const basename = pathParts.pop() ?? '';
  const extensionStart = basename.lastIndexOf('.');
  if (extensionStart <= 0) return basename;
  return basename.slice(0, extensionStart);
}

function replaceInvalidFilenameChars(value: string): string {
  let next = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    next +=
      codePoint !== undefined && (codePoint < 32 || INVALID_FILENAME_CHARS.includes(char))
        ? '-'
        : char;
  }
  return next;
}

function sanitizeFilenameStem(value: string): string {
  return replaceInvalidFilenameChars(value.normalize('NFKC').trim())
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '')
    .slice(0, MAX_FILENAME_STEM_LENGTH)
    .replace(/[ .-]+$/g, '');
}

function displayTitleForPlan(plan: PlanDownloadInput): string {
  const title = plan.title.trim();
  if (title) return title;

  const basename = filenameStemFromPath(plan.filePath).trim();
  return basename || 'Agendex plan';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toISOString();
}

export function createPlanDownloadFilename(
  plan: PlanDownloadInput,
  format: PlanDownloadFormat,
): string {
  const stemCandidates = [plan.title, filenameStemFromPath(plan.filePath), FALLBACK_PLAN_NAME];
  const stem =
    stemCandidates.map(sanitizeFilenameStem).find((candidate) => candidate.length > 0) ??
    FALLBACK_PLAN_NAME;
  return `${stem}.${PLAN_DOWNLOAD_EXTENSIONS[format]}`;
}

export function createPlanMarkdownContent(plan: PlanDownloadInput): string {
  return normalizeLineEndings(plan.content);
}

export function createPlanHtmlDocument(plan: PlanDownloadInput): string {
  const title = displayTitleForPlan(plan);
  const escapedTitle = escapeHtml(title);
  const escapedAgent = escapeHtml(plan.agent);
  const escapedUpdatedAt = escapeHtml(formatUpdatedAt(plan.updatedAt));
  const escapedPath = escapeHtml(plan.filePath);
  const escapedBody = escapeHtml(createPlanMarkdownContent(plan));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedTitle} - Agendex plan</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8f3;
      --surface: #ffffff;
      --text: #11160d;
      --secondary: #5f6f67;
      --border: #d8dfd2;
      --accent: #6b8f00;
      --mono: "SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace;
      --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.55; margin: 0; }
    .plan-document { margin: 0 auto; max-width: 920px; padding: 44px 28px 56px; }
    .plan-sheet { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 34px; }
    h1 { font-size: 28px; line-height: 1.18; letter-spacing: 0; margin: 0 0 16px; }
    .plan-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 14px; margin: 0 0 28px; color: var(--secondary); font-size: 12px; }
    .plan-meta dt { color: var(--text); font-weight: 650; }
    .plan-meta dd { margin: 0; overflow-wrap: anywhere; }
    .plan-body { border-top: 1px solid var(--border); color: var(--text); font-family: var(--mono); font-size: 13px; line-height: 1.62; margin: 0; overflow-wrap: anywhere; padding-top: 28px; white-space: pre-wrap; }
    @media print {
      body { background: #ffffff; }
      .plan-document { max-width: none; padding: 0; }
      .plan-sheet { border: 0; border-radius: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="plan-document">
    <article class="plan-sheet">
      <h1>${escapedTitle}</h1>
      <dl class="plan-meta">
        <dt>Agent</dt>
        <dd>${escapedAgent}</dd>
        <dt>Updated</dt>
        <dd><time datetime="${escapedUpdatedAt}">${escapedUpdatedAt}</time></dd>
        <dt>Path</dt>
        <dd>${escapedPath}</dd>
      </dl>
      <pre class="plan-body">${escapedBody}</pre>
    </article>
  </main>
</body>
</html>`;
}

export function downloadPlanBlob(download: DirectPlanDownload): void {
  const blob = new Blob([download.content], { type: download.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function openPlanPdfPrintWindow(plan: PlanDownloadInput): void {
  const printWindow = window.open('', '_blank', 'width=960,height=720');
  if (!printWindow) {
    throw new Error('Unable to open the print window. Allow popups and try again.');
  }

  const triggerPrint = (): void => {
    printWindow.requestAnimationFrame(() => {
      printWindow.focus();
      printWindow.print();
    });
  };

  printWindow.document.open();
  printWindow.document.write(createPlanHtmlDocument(plan));
  printWindow.document.close();

  if (printWindow.document.readyState === 'complete') {
    triggerPrint();
    return;
  }

  printWindow.addEventListener('load', triggerPrint, { once: true });
}

export function downloadPlan(plan: PlanDownloadInput, format: PlanDownloadFormat): void {
  const filename = createPlanDownloadFilename(plan, format);

  switch (format) {
    case 'md':
      downloadPlanBlob({
        filename,
        content: createPlanMarkdownContent(plan),
        mimeType: 'text/markdown;charset=utf-8',
      });
      return;
    case 'html':
      downloadPlanBlob({
        filename,
        content: createPlanHtmlDocument(plan),
        mimeType: 'text/html;charset=utf-8',
      });
      return;
    case 'pdf':
      openPlanPdfPrintWindow(plan);
      return;
    default:
      assertNever(format);
  }
}
