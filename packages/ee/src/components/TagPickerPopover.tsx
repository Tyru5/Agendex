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
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '4px',
        width: '220px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 100,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px' }}>
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
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: '12px',
            fontFamily: 'inherit',
            borderRadius: '5px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div
        style={{
          maxHeight: '180px',
          overflowY: 'auto',
          padding: '0 4px 4px',
        }}
      >
        {allTags === undefined ? (
          <div style={{ padding: '8px', fontSize: '12px', color: 'var(--tertiary)' }}>Loading…</div>
        ) : allTags.length === 0 && !newName.trim() ? (
          <div style={{ padding: '8px', fontSize: '12px', color: 'var(--tertiary)' }}>
            Type to create your first tag
          </div>
        ) : (
          allTags
            .filter((t) => !newName.trim() || t.nameLc.includes(newName.trim().toLowerCase()))
            .map((tag) => (
              <button
                key={tag._id}
                type="button"
                onClick={() => handleToggle(tag._id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: '12.5px',
                  fontFamily: 'inherit',
                  fontWeight: 450,
                  borderRadius: '5px',
                  border: 'none',
                  background: assignedIds.has(tag._id) ? 'var(--active)' : 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: tag.color || 'var(--tertiary)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
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
                    style={{ flexShrink: 0, color: 'var(--secondary)' }}
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
