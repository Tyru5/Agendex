import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { CollectionPickerPopover } from './CollectionPickerPopover.tsx';
import { TagChip } from './TagChip.tsx';
import { TagPickerPopover } from './TagPickerPopover.tsx';

export function PlanTagsBar({ planId }: { planId: string }) {
  const planTagsMap = useQuery(api.planTags.getTagsForPlans, { planIds: [planId as Id<'plans'>] });
  const removeTag = useMutation(api.planTags.removeTag);

  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);

  const tags = planTagsMap?.[planId] ?? [];

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      {tags.map((tag: any) => (
        <TagChip
          key={tag._id}
          name={tag.name}
          color={tag.color}
          onRemove={() => removeTag({ planId: planId as Id<'plans'>, tagId: tag._id })}
        />
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowTagPicker(!showTagPicker);
            setShowCollectionPicker(false);
          }}
          title="Add tag"
          className="py-0.5 px-[7px] text-[12px] font-medium font-[inherit] rounded-[5px] border border-dashed border-border bg-transparent text-tertiary cursor-pointer inline-flex items-center gap-[3px]"
        >
          <svg
            aria-hidden="true"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
            <path d="M7 7h.01" />
          </svg>
          Tag
        </button>
        {showTagPicker && (
          <TagPickerPopover planId={planId} onClose={() => setShowTagPicker(false)} />
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowCollectionPicker(!showCollectionPicker);
            setShowTagPicker(false);
          }}
          title="Add to collection"
          className="py-0.5 px-[7px] text-[12px] font-medium font-[inherit] rounded-[5px] border border-dashed border-border bg-transparent text-tertiary cursor-pointer inline-flex items-center gap-[3px]"
        >
          <svg
            aria-hidden="true"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Collection
        </button>
        {showCollectionPicker && (
          <CollectionPickerPopover planId={planId} onClose={() => setShowCollectionPicker(false)} />
        )}
      </div>
    </div>
  );
}
