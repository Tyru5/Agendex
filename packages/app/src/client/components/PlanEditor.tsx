import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { api, type Plan } from '../lib/api.ts';

export function PlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!editorRef.current) return;

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const state = EditorState.create({
      doc: plan.content,
      extensions: [
        markdown(),
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        ...(isDark ? [oneDark] : []),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
  }, [plan.content]);

  async function save() {
    if (!viewRef.current) return;
    const content = viewRef.current.state.doc.toString();
    setSaving(true);
    setError(undefined);
    try {
      await api.updatePlan(plan.id, content);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h1 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
            Editing: {plan.title}
          </h1>
          <p
            style={{
              fontSize: '11.5px',
              color: 'var(--tertiary)',
              marginTop: '2px',
              fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
            }}
          >
            {plan.filePath}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={save}
            disabled={saving}
            style={{
              padding: '5px 12px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: 'none',
              background: 'var(--text)',
              color: 'var(--bg)',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
