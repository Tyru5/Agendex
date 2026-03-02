import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

export function TagPickerPopover({ planId, onClose }: { planId: string; onClose: () => void }) {
  const allTags = useQuery(api.tags.listMyTags);
  const planTagsMap = useQuery(api.planTags.getTagsForPlans, { planIds: [planId] });
  const addTag = useMutation(api.planTags.addTag);
  const removeTag = useMutation(api.planTags.removeTag);
  const createTag = useMutation(api.tags.createTag);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const assignedIds = new Set((planTagsMap?.[planId] ?? []).map((t: any) => t._id));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const tagId = await createTag({ name: trimmed });
      await addTag({ planId, tagId });
      setNewName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(tagId: string) {
    if (assignedIds.has(tagId)) {
      await removeTag({ planId, tagId });
    } else {
      await addTag({ planId, tagId });
    }
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 w-[220px] bg-(--surface) border border-border rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-[100] overflow-hidden"
    >
      <div className="p-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Create or search tags…"
          className="w-full py-[5px] px-2 text-[12px] font-[inherit] rounded-[5px] border border-border bg-transparent text-text outline-none box-border"
        />
      </div>

      <div className="max-h-[180px] overflow-y-auto px-1 pb-1 pt-0">
        {allTags === undefined ? (
          <div className="p-2 text-[12px] text-tertiary">Loading…</div>
        ) : allTags.length === 0 && !newName.trim() ? (
          <div className="p-2 text-[12px] text-tertiary">Type to create your first tag</div>
        ) : (
          allTags
            .filter((t: any) => !newName.trim() || t.nameLc.includes(newName.trim().toLowerCase()))
            .map((tag: any) => (
              <button
                key={tag._id}
                type="button"
                onClick={() => handleToggle(tag._id)}
                className="flex items-center gap-2 w-full py-[5px] px-2 text-[12.5px] font-[inherit] font-[450] rounded-[5px] border-none text-text cursor-pointer text-left"
                style={{ background: assignedIds.has(tag._id) ? 'var(--active)' : 'transparent' }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: tag.color || 'var(--tertiary)' }}
                />
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {tag.name}
                </span>
                {assignedIds.has(tag._id) && (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-secondary"
                  >
                    <path d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            ))
        )}
      </div>
    </div>
  );
}
