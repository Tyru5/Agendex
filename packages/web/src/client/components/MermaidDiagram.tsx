import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme.ts';

let mermaidIdSeq = 0;

function nextMermaidDomId(): string {
  mermaidIdSeq += 1;
  return `agendex-mermaid-${mermaidIdSeq}`;
}

export function MermaidDiagram({
  code,
  className,
}: {
  code: string;
  className?: string | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const domId = useMemo(() => nextMermaidDomId(), []);
  const definition = code.replace(/\n$/, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const prevDefinitionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (prevDefinitionRef.current !== definition) {
      setSvg(null);
      prevDefinitionRef.current = definition;
    }

    async function run() {
      setBusy(true);
      setError(null);
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        const { svg: out } = await mermaid.render(domId, definition);
        if (cancelled) return;
        setSvg(out);
      } catch (e) {
        if (cancelled) return;
        setSvg(null);
        setError(e instanceof Error ? e.message : 'Invalid Mermaid diagram');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [definition, domId, resolvedTheme]);

  const mergedClassName = [className, 'plan-mermaid-host'].filter(Boolean).join(' ');

  if (error) {
    return (
      <code className={mergedClassName}>
        <span className="plan-mermaid-error">{error}</span>
      </code>
    );
  }

  if (busy && !svg) {
    return (
      <code className={mergedClassName}>
        <span className="plan-mermaid-loading">Rendering diagram…</span>
      </code>
    );
  }

  return (
    <code className={mergedClassName}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from Mermaid (trusted renderer) */}
      <span className="plan-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
    </code>
  );
}
