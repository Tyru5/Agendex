import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../hooks/useTheme.ts';
import type { ResolvedTheme } from './ThemeProvider.tsx';

function canvasBackgroundForTheme(resolvedTheme: ResolvedTheme): string {
  if (typeof document === 'undefined') {
    return resolvedTheme === 'dark' ? '#161616' : '#ffffff';
  }
  const fromCss = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  return fromCss.length > 0 ? fromCss : resolvedTheme === 'dark' ? '#161616' : '#ffffff';
}

let mermaidIdSeq = 0;

function nextMermaidDomId(): string {
  mermaidIdSeq += 1;
  return `agendex-mermaid-${mermaidIdSeq}`;
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6 2H3a1 1 0 0 0-1 1v3m8-4h3a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1-1 1h-3M2 10v3a1 1 0 0 0 1 1h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2M8 2v8.5m0 0L5 7.5m3 3L11 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 5l8 8M13 5l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function downloadSvg(svgHtml: string, filename: string) {
  const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadPng(svgHtml: string, filename: string, canvasBackground: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgHtml, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return;

  const w = svgEl.getAttribute('width');
  const h = svgEl.getAttribute('height');
  const viewBox = svgEl.getAttribute('viewBox');
  let width = 1200;
  let height = 800;

  if (w && h) {
    width = Math.round(Number.parseFloat(w)) * 2;
    height = Math.round(Number.parseFloat(h)) * 2;
  } else if (viewBox) {
    const parts = viewBox.split(/[\s,]+/);
    if (parts[2] && parts[3]) {
      width = Math.round(Number.parseFloat(parts[2])) * 2;
      height = Math.round(Number.parseFloat(parts[3])) * 2;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  const svgBlob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.fillStyle = canvasBackground;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(pngUrl);
    }, 'image/png');
  };
  img.src = url;
}

function MermaidDownloadControls({
  svg,
  resolvedTheme,
}: {
  svg: string;
  resolvedTheme: ResolvedTheme;
}) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!downloadOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [downloadOpen]);

  return (
    <span ref={menuRef} className="plan-mermaid-download-wrap">
      <button
        type="button"
        className="plan-mermaid-toolbar-btn"
        onClick={() => setDownloadOpen((p) => !p)}
        title="Download diagram"
      >
        <DownloadIcon />
      </button>
      {downloadOpen && (
        <span className="plan-mermaid-download-menu">
          <button
            type="button"
            className="plan-mermaid-download-item"
            onClick={() => {
              downloadSvg(svg, 'diagram.svg');
              setDownloadOpen(false);
            }}
          >
            Download SVG
          </button>
          <button
            type="button"
            className="plan-mermaid-download-item"
            onClick={() => {
              downloadPng(svg, 'diagram.png', canvasBackgroundForTheme(resolvedTheme));
              setDownloadOpen(false);
            }}
          >
            Download PNG
          </button>
        </span>
      )}
    </span>
  );
}

function MermaidToolbar({
  svg,
  onExpand,
  resolvedTheme,
}: {
  svg: string;
  onExpand: () => void;
  resolvedTheme: ResolvedTheme;
}) {
  return (
    <span className="plan-mermaid-toolbar">
      <button
        type="button"
        className="plan-mermaid-toolbar-btn"
        onClick={onExpand}
        title="Expand diagram"
      >
        <ExpandIcon />
      </button>
      <MermaidDownloadControls svg={svg} resolvedTheme={resolvedTheme} />
    </span>
  );
}

const modalExitMs = 220;

function MermaidExpandedModal({
  svg,
  onClose,
  resolvedTheme,
}: {
  svg: string;
  onClose: () => void;
  resolvedTheme: ResolvedTheme;
}) {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, modalExitMs);
  }, [onClose]);

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded diagram"
      className="fixed inset-0 z-[130] flex items-center justify-center p-6"
      style={{
        background: 'rgba(0,0,0,0.55)',
        opacity: open ? 1 : 0,
        backdropFilter: open ? 'blur(4px)' : 'blur(0px)',
        transition: `opacity ${modalExitMs}ms ease, backdrop-filter 260ms ease`,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="relative w-full max-w-[90vw] max-h-[90vh] rounded-[14px] bg-surface border border-border shadow-[0_24px_50px_rgba(0,0,0,0.3)] overflow-auto"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.95)',
          transition: `opacity ${modalExitMs}ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        <div className="sticky top-0 right-0 z-10 flex justify-end p-3 gap-2">
          <MermaidDownloadControls svg={svg} resolvedTheme={resolvedTheme} />
          <button
            type="button"
            className="plan-mermaid-toolbar-btn"
            onClick={handleClose}
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex items-center justify-center p-6 pt-0 plan-mermaid-expanded-svg">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from Mermaid (trusted renderer) */}
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
    </div>
  );
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
  const [expanded, setExpanded] = useState(false);
  const prevDefinitionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (prevDefinitionRef.current !== definition) {
      setSvg(null);
      setExpanded(false);
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
        setExpanded(false);
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
  const expandedModal =
    expanded && svg && typeof document !== 'undefined'
      ? createPortal(
          <MermaidExpandedModal
            svg={svg}
            onClose={() => setExpanded(false)}
            resolvedTheme={resolvedTheme}
          />,
          document.body,
        )
      : null;

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
    <>
      <code className={mergedClassName}>
        <span className="plan-mermaid-container">
          {svg && (
            <MermaidToolbar
              svg={svg}
              onExpand={() => setExpanded(true)}
              resolvedTheme={resolvedTheme}
            />
          )}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from Mermaid (trusted renderer) */}
          <span
            className="plan-mermaid-svg plan-mermaid-clickable"
            dangerouslySetInnerHTML={{ __html: svg ?? '' }}
            onClick={() => setExpanded(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded(true);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Click to expand diagram"
          />
        </span>
      </code>
      {expandedModal}
    </>
  );
}
