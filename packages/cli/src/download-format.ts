export type PlanDownloadFormat = 'md' | 'html';

export type PlanDownloadContentInput = {
  readonly agent: string;
  readonly content: string;
  readonly filePath: string;
  readonly title: string;
  readonly updatedAt: string;
};

const MAX_FILENAME_STEM_LENGTH = 90;
const MAX_FILENAME_COMPONENT_BYTES = 255;
const FALLBACK_PLAN_NAME = 'agendex-plan';
const INVALID_FILENAME_CHARS = '<>:"/\\|?*';
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function parsePlanDownloadFormat(value: string): PlanDownloadFormat | 'pdf' | 'invalid' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'md' || normalized === 'markdown' || normalized === '.md') return 'md';
  if (normalized === 'html' || normalized === 'htm' || normalized === '.html') return 'html';
  if (normalized === 'pdf' || normalized === '.pdf') return 'pdf';
  return 'invalid';
}

export function inferPlanDownloadFormat(path: string): PlanDownloadFormat | 'pdf' | undefined {
  const match = path
    .trim()
    .toLowerCase()
    .match(/(\.[a-z0-9]+)$/);
  if (!match?.[1]) return undefined;
  const parsed = parsePlanDownloadFormat(match[1]);
  return parsed === 'invalid' ? undefined : parsed;
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

function isInvisibleFilenameChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return true;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  if (codePoint === 0x061c || codePoint === 0x2060 || codePoint === 0xfeff) return true;
  if (codePoint >= 0x200b && codePoint <= 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return false;
}

function replaceInvalidFilenameChars(value: string): string {
  let next = '';
  for (const char of value) {
    if (isInvisibleFilenameChar(char)) continue;
    next += INVALID_FILENAME_CHARS.includes(char) ? '-' : char;
  }
  return next;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let next = '';
  for (const char of value) {
    const candidate = next + char;
    if (utf8ByteLength(candidate) > maxBytes) break;
    next = candidate;
  }
  return next;
}

function sanitizeFilenameStem(value: string): string {
  const cleaned = replaceInvalidFilenameChars(value.normalize('NFKC').trim())
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '');
  return Array.from(cleaned)
    .slice(0, MAX_FILENAME_STEM_LENGTH)
    .join('')
    .replace(/[ .-]+$/g, '');
}

const WINDOWS_RESERVED_DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;

function rewriteReservedFilenameStem(stem: string): string {
  const device = stem.split('.')[0]?.trim() ?? '';
  if (!WINDOWS_RESERVED_DEVICE.test(device)) return stem;
  return `${FALLBACK_PLAN_NAME}-${device}`;
}

function displayTitleForPlan(plan: PlanDownloadContentInput): string {
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
  plan: PlanDownloadContentInput,
  format: PlanDownloadFormat,
): string {
  const stemCandidates = [plan.title, filenameStemFromPath(plan.filePath), FALLBACK_PLAN_NAME];
  const extension = `.${format}`;
  const maxStemBytes = MAX_FILENAME_COMPONENT_BYTES - extension.length;
  const stem =
    truncateToUtf8Bytes(
      rewriteReservedFilenameStem(
        stemCandidates.map(sanitizeFilenameStem).find((candidate) => candidate.length > 0) ??
          FALLBACK_PLAN_NAME,
      ),
      maxStemBytes,
    ).replace(/[ .-]+$/g, '') || FALLBACK_PLAN_NAME;
  return `${stem}${extension}`;
}

export function createPlanMarkdownContent(plan: PlanDownloadContentInput): string {
  return normalizeLineEndings(plan.content);
}

export function createPlanHtmlDocument(plan: PlanDownloadContentInput): string {
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

export function renderPlanDownload(
  plan: PlanDownloadContentInput,
  format: PlanDownloadFormat,
): string {
  return format === 'html' ? createPlanHtmlDocument(plan) : createPlanMarkdownContent(plan);
}
