import { createContext, type ReactNode, useContext } from 'react';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.tsx';
import { PlanPathCode } from './PlanPathLink.tsx';

const FencedCodeContext = createContext(false);

export function PlanMarkdownPre({
  children,
  node: _node,
  ...props
}: {
  children?: ReactNode;
  node?: unknown;
}) {
  // Mark descendants so single-line fences without a language class are not
  // mistaken for inline `code` path links.
  return (
    <FencedCodeContext.Provider value={true}>
      <pre {...props}>{children}</pre>
    </FencedCodeContext.Provider>
  );
}

export function PlanMarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: {
  className?: string;
  children?: ReactNode;
  node?: unknown;
}) {
  const inFencedBlock = useContext(FencedCodeContext);
  const code = String(children).replace(/\n$/, '');
  const language = /(?:lang|language)-([^\s]+)/.exec(className ?? '')?.[1];
  const isBlock = inFencedBlock || Boolean(language) || code.includes('\n');

  if (!isBlock) {
    // Renders validated file paths as jump-to-source links; plain code
    // otherwise (including whenever no PlanPathContext is provided).
    return (
      <PlanPathCode className={className} {...props}>
        {children}
      </PlanPathCode>
    );
  }

  return <MarkdownCodeBlock className={className} code={code} language={language} />;
}
