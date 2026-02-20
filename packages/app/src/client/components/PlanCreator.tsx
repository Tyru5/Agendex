import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { type AgentStats, api, type Plan } from '../lib/api.ts';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.tsx';

export function PlanCreator({
  agents,
  onClose,
  onCreated,
}: {
  agents: AgentStats[];
  onClose: () => void;
  onCreated: (plan: Plan) => void;
}) {
  const [agent, setAgent] = useState(agents[0]?.agent ?? '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [splitRatio, setSplitRatio] = useState(0.5);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!editorRef.current) return;

    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const state = EditorState.create({
      doc: '',
      extensions: [
        markdown(),
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setContent(update.state.doc.toString());
          }
        }),
        ...(isDark ? [oneDark] : []),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  async function handleCreate() {
    if (!title.trim() || !content.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      const plan = await api.createPlan(agent, title.trim(), content.trim());
      onCreated(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 gap-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            style={{
              padding: '5px 8px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {agents.map((a) => (
              <option key={a.agent} value={a.agent}>
                {getAgentLabel(a.agent)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Plan title..."
            style={{
              flex: 1,
              padding: '5px 10px',
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {error && <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '5px 12px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--secondary)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !title.trim() || !content.trim()}
            style={{
              padding: '5px 12px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: 'none',
              background: 'var(--text)',
              color: 'var(--bg)',
              cursor: creating ? 'default' : 'pointer',
              opacity: creating || !title.trim() || !content.trim() ? 0.5 : 1,
            }}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Split pane */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
        {/* Editor pane */}
        <div
          ref={editorRef}
          className="overflow-auto"
          style={{ width: `${splitRatio * 100}%`, minWidth: 0 }}
        />

        {/* Drag handle */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: resize drag handle */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: '5px',
            cursor: 'col-resize',
            background: 'var(--border)',
            flexShrink: 0,
            transition: 'background 120ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border)')}
        />

        {/* Preview pane */}
        <div
          className="overflow-auto"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '24px 32px',
          }}
        >
          {content ? (
            <article className="plan-markdown">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, node: _node, ...props }) {
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

                    return (
                      <MarkdownCodeBlock className={className} code={code} language={language} />
                    );
                  },
                }}
              >
                {`# ${title || 'Untitled'}\n\n${content}`}
              </Markdown>
            </article>
          ) : (
            <div
              className="h-full flex items-center justify-center"
              style={{ fontSize: '13px', color: 'var(--tertiary)' }}
            >
              Start typing to see preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
