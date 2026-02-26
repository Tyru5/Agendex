import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

export function CollectionPickerPopover({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  const collections = useQuery(api.collections.listMyCollections);
  const memberCollectionIds = useQuery(api.collections.getCollectionsForPlan, { planId });
  const addToCollection = useMutation(api.collections.addPlanToCollection);
  const removeFromCollection = useMutation(api.collections.removePlanFromCollection);
  const createCollection = useMutation(api.collections.createCollection);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const memberSet = new Set(memberCollectionIds ?? []);

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
      const collectionId = await createCollection({ name: trimmed });
      await addToCollection({ collectionId, planId });
      setNewName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(collectionId: string) {
    if (memberSet.has(collectionId)) {
      await removeFromCollection({ collectionId, planId });
    } else {
      await addToCollection({ collectionId, planId });
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
          placeholder="Create or search collections…"
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
        {collections === undefined || memberCollectionIds === undefined ? (
          <div style={{ padding: '8px', fontSize: '12px', color: 'var(--tertiary)' }}>Loading…</div>
        ) : collections.length === 0 && !newName.trim() ? (
          <div style={{ padding: '8px', fontSize: '12px', color: 'var(--tertiary)' }}>
            Type to create your first collection
          </div>
        ) : (
          collections
            .filter((c: any) => !newName.trim() || c.nameLc.includes(newName.trim().toLowerCase()))
            .map((col: any) => (
              <button
                key={col._id}
                type="button"
                onClick={() => handleToggle(col._id)}
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
                  background: memberSet.has(col._id) ? 'var(--active)' : 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, color: 'var(--secondary)' }}
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.name}
                </span>
                {memberSet.has(col._id) && (
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
