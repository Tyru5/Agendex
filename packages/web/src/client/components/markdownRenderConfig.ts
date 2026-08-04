import type { Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { splitBareCodePathText } from '../lib/plan-paths.ts';
import { sanitizeSchema } from '../lib/sanitize-schema.ts';
import { PlanMarkdownCode, PlanMarkdownPre } from './PlanMarkdownRenderers.tsx';

/** Stable react-markdown component map — must not be recreated per render. */
export const planMarkdownComponents: Components = {
  pre: PlanMarkdownPre,
  code: PlanMarkdownCode,
};

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

const PATH_TRANSFORM_SKIP_TYPES = new Set([
  'code',
  'inlineCode',
  'link',
  'linkReference',
  'definition',
  'html',
]);

/** Turn strict bare path mentions into inline-code nodes so validation and rendering agree. */
function remarkPlanPathMentions() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || PATH_TRANSFORM_SKIP_TYPES.has(node.type)) return;

      const nextChildren: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          visit(child);
          nextChildren.push(child);
          continue;
        }

        const parts = splitBareCodePathText(child.value);
        nextChildren.push(
          ...parts.map((part) => ({
            type: part.isPath ? 'inlineCode' : 'text',
            value: part.value,
          })),
        );
      }
      node.children = nextChildren;
    };

    visit(tree);
  };
}

export const planMarkdownRemarkPlugins = [remarkGfm, remarkPlanPathMentions];

export const planMarkdownRehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug];
