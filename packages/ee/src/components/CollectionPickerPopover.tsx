import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import {
  buildCollectionWrite,
  useCloudCollections,
  useWorkspaceCryptoStatus,
} from '../hooks/useCloudMetadataCrypto.ts';

export function CollectionPickerPopover({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  const collections = useCloudCollections();
  const cryptoStatus = useWorkspaceCryptoStatus();
  const memberCollectionIds = useQuery(api.collections.getCollectionsForPlan, {
    planId: planId as Id<'plans'>,
  });
  const addToCollection = useMutation(api.collections.addPlanToCollection);
  const removeFromCollection = useMutation(api.collections.removePlanFromCollection);
  const createCollection = useMutation(api.collections.createCollection);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const memberSet = new Set<string>(memberCollectionIds ?? []);

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
      const collectionId = await createCollection(buildCollectionWrite(cryptoStatus, trimmed));
      await addToCollection({ collectionId, planId: planId as Id<'plans'> });
      setNewName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(collectionId: string) {
    if (memberSet.has(collectionId)) {
      await removeFromCollection({
        collectionId: collectionId as Id<'collections'>,
        planId: planId as Id<'plans'>,
      });
    } else {
      await addToCollection({
        collectionId: collectionId as Id<'collections'>,
        planId: planId as Id<'plans'>,
      });
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
          placeholder="Create or search collections…"
          className="w-full py-[5px] px-2 text-[12px] font-[inherit] rounded-[5px] border border-border bg-transparent text-text outline-none box-border"
        />
      </div>

      <div className="max-h-[180px] overflow-y-auto px-1 pb-1 pt-0">
        {collections === undefined || memberCollectionIds === undefined ? (
          <div className="p-2 text-[12px] text-tertiary">Loading…</div>
        ) : collections.length === 0 && !newName.trim() ? (
          <div className="p-2 text-[12px] text-tertiary">Type to create your first collection</div>
        ) : (
          collections
            .filter(
              (collection) =>
                !newName.trim() || collection.nameLc.includes(newName.trim().toLowerCase()),
            )
            .map((col) => (
              <button
                key={col._id}
                type="button"
                onClick={() => handleToggle(col._id)}
                className="flex items-center gap-2 w-full py-[5px] px-2 text-[12.5px] font-[inherit] font-[450] rounded-[5px] border-none text-text cursor-pointer text-left"
                style={{ background: memberSet.has(col._id) ? 'var(--active)' : 'transparent' }}
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
                  className="shrink-0 text-secondary"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
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
