import GithubSlugger from 'github-slugger';
import type { Heading, Text, InlineCode } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export interface HeadingEntry {
  id: string;
  text: string;
  level: number;
}

function textContent(node: Heading): string {
  const parts: string[] = [];
  visit(node, (child) => {
    if (child.type === 'text') parts.push((child as Text).value);
    else if (child.type === 'inlineCode') parts.push((child as InlineCode).value);
  });
  return parts.join('');
}

export function extractHeadings(markdown: string): HeadingEntry[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const headings: HeadingEntry[] = [];
  const slugger = new GithubSlugger();

  visit(tree, 'heading', (node: Heading) => {
    if (node.depth < 2 || node.depth > 4) return;
    const text = textContent(node);
    if (!text) return;

    const id = slugger.slug(text);
    headings.push({ id, text, level: node.depth });
  });

  return headings;
}
