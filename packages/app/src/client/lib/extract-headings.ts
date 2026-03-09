import GithubSlugger from 'github-slugger';
import type { Heading, InlineCode, Text } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { looksLikeMarkdown, normalizePlanMarkdown } from './plan-markdown.ts';

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
  source: 'heading' | 'bold_label' | 'fallback_root';
}

function textContent(node: Heading): string {
  const parts: string[] = [];
  visit(node, (child) => {
    if (child.type === 'text') parts.push((child as Text).value);
    else if (child.type === 'inlineCode') parts.push((child as InlineCode).value);
  });
  return parts.join('');
}

function normalizeOutlineText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getFenceInfo(line: string): { marker: '`' | '~'; length: number } | null {
  const fenceMatch = /^([ \t]*)(`{3,}|~{3,})/.exec(line);
  if (!fenceMatch?.[2]) return null;
  return {
    marker: fenceMatch[2][0] as '`' | '~',
    length: fenceMatch[2].length,
  };
}

function updateFenceState(
  activeFence: { marker: '`' | '~'; length: number } | null,
  line: string,
): { marker: '`' | '~'; length: number } | null {
  const fence = getFenceInfo(line);
  if (!fence) return activeFence;
  if (!activeFence) return fence;
  if (activeFence.marker === fence.marker && fence.length >= activeFence.length) return null;
  return activeFence;
}

function isMarkdownPlan({
  content,
  filePath,
  format,
}: {
  content: string;
  filePath: string;
  format: string;
}): boolean {
  if (format.toLowerCase() === 'md') return true;
  if (/\.mdx?$/i.test(filePath)) return true;
  return looksLikeMarkdown(content);
}

function promoteBoldLabels(markdown: string): {
  content: string;
  syntheticHeadingLines: Set<number>;
} {
  const syntheticHeadingLines = new Set<number>();
  const renderedLines: string[] = [];
  let activeFence: { marker: '`' | '~'; length: number } | null = null;

  for (const line of markdown.split('\n')) {
    const nextFenceState = updateFenceState(activeFence, line);
    if (nextFenceState !== activeFence || getFenceInfo(line)) {
      activeFence = nextFenceState;
      renderedLines.push(line);
      continue;
    }

    const boldLabelMatch = !activeFence ? /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line) : null;
    if (boldLabelMatch?.[1]) {
      const text = boldLabelMatch[1].trim().replace(/:+$/, '').trim();
      if (text) {
        syntheticHeadingLines.add(renderedLines.length + 1);
        renderedLines.push(`## ${text}`);
        continue;
      }
    }

    renderedLines.push(line);
  }

  return { content: renderedLines.join('\n'), syntheticHeadingLines };
}

function injectBoldLabelAnchors(markdown: string, entries: OutlineEntry[]): string {
  const boldEntries = entries.filter((e) => e.source === 'bold_label');
  if (boldEntries.length === 0) return markdown;

  const lines = markdown.split('\n');
  const result: string[] = [];
  let activeFence: { marker: '`' | '~'; length: number } | null = null;
  let entryIdx = 0;

  for (const line of lines) {
    const nextFenceState = updateFenceState(activeFence, line);
    if (nextFenceState !== activeFence || getFenceInfo(line)) {
      activeFence = nextFenceState;
      result.push(line);
      continue;
    }

    const nextEntry = !activeFence ? boldEntries[entryIdx] : undefined;
    if (nextEntry) {
      const boldLabelMatch = /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line);
      if (boldLabelMatch?.[1]) {
        const text = boldLabelMatch[1].trim().replace(/:+$/, '').trim();
        if (text && normalizeOutlineText(text) === normalizeOutlineText(nextEntry.text)) {
          result.push(`<div data-agendex-anchor="${nextEntry.id}"></div>`);
          entryIdx++;
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

function extractOutlineEntries(
  markdown: string,
  syntheticHeadingLines: Set<number>,
): OutlineEntry[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const entries: OutlineEntry[] = [];
  const slugger = new GithubSlugger();
  let previousEntryText: string | null = null;

  visit(tree, 'heading', (node: Heading) => {
    if (node.depth < 1 || node.depth > 4) return;

    const text = textContent(node).trim();
    if (!text) return;

    const id = slugger.slug(text);
    const normalizedText = normalizeOutlineText(text);
    if (normalizedText === previousEntryText) return;

    previousEntryText = normalizedText;
    entries.push({
      id,
      text,
      level: node.depth,
      source: syntheticHeadingLines.has(node.position?.start.line ?? -1) ? 'bold_label' : 'heading',
    });
  });

  return entries;
}

export function buildPlanOutline({
  title,
  content,
  filePath,
  format,
}: {
  title: string;
  content: string;
  filePath: string;
  format: string;
}): {
  entries: OutlineEntry[];
  renderMode: 'markdown' | 'plain';
  renderContent: string;
} {
  const plainContent = content.replace(/\r\n?/g, '\n');
  const markdownCandidate = normalizePlanMarkdown(content);
  const { content: renderMarkdown, syntheticHeadingLines } = promoteBoldLabels(markdownCandidate);
  const structuredEntries = extractOutlineEntries(renderMarkdown, syntheticHeadingLines);
  const renderMode =
    structuredEntries.length > 0 || isMarkdownPlan({ content: markdownCandidate, filePath, format })
      ? 'markdown'
      : 'plain';

  return {
    entries:
      structuredEntries.length > 0
        ? structuredEntries
        : [
            {
              id: 'plan-top',
              text: title.trim() || filePath || 'Plan',
              level: 1,
              source: 'fallback_root',
            },
          ],
    renderMode,
    renderContent:
      renderMode === 'markdown'
        ? injectBoldLabelAnchors(markdownCandidate, structuredEntries)
        : plainContent,
  };
}
