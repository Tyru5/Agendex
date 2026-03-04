import { useEffect, useState } from 'react';
import { type Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';

export function CloudPlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updatePlanContent = useMutation(api.plans.updatePlanContent);
  const [content, setContent] = useState(plan.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setContent(plan.content);
    setError(undefined);
  }, [plan.id, plan.content]);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await updatePlanContent({
        planId: plan.id as Id<'plans'>,
        title: plan.title,
        content,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div>
          <h1 className="text-[14px] font-semibold text-text">Editing: {plan.title}</h1>
          <p className="text-[11.5px] text-tertiary mt-0.5 font-[var(--font-mono,monospace)]">
            Cloud plan
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-[#ef4444]">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border-0 bg-text text-bg"
            style={{
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="h-full w-full resize-none rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] leading-6 text-text outline-none"
        />
      </div>
    </div>
  );
}
