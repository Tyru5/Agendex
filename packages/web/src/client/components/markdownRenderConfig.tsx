import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { sanitizeSchema } from '../lib/sanitize-schema.ts';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.tsx';

function PlanMarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: {
  className?: string;
  children?: ReactNode;
  node?: unknown;
}) {
  const code = String(children).replace(/\n$/, '');
  const language = /(?:lang|language)-([^\s]+)/.exec(className ?? '')?.[1];
  const isBlock = Boolean(language) || code.includes('\n');

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return <MarkdownCodeBlock className={className} code={code} language={language} />;
}

/** Stable react-markdown component map — must not be recreated per render. */
export const planMarkdownComponents: Components = {
  code: PlanMarkdownCode,
};

export const planMarkdownRemarkPlugins = [remarkGfm];

export const planMarkdownRehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug];
