import { useState, useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap } from '@codemirror/commands';
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
  }, [plan.id]);

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
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold">Editing: {plan.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{plan.filePath}</p>
        </div>
        <div className="flex gap-2">
          {error && <span className="text-red-500 text-sm self-center">{error}</span>}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
