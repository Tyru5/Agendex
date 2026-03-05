import type { AgentStats } from '../lib/api.ts';
import { AgentFilter } from './AgentFilter.tsx';

type SortBy = 'updatedAt' | 'createdAt' | 'title';
type DateBucket = 'all' | 'today' | '7d' | '30d';

const labelClass = 'text-[11px] font-[550] uppercase tracking-[0.06em] text-tertiary px-2 mb-1';

const selectClass =
  'w-full p-[5px_8px] rounded-[7px] border border-border bg-surface text-text text-[12.5px] font-[inherit] font-[450] cursor-pointer outline-none';

export function SidebarFilters({
  sortBy,
  onSortChange,
  dateBucket,
  onDateBucketChange,
  agents,
  selectedAgent,
  onAgentSelect,
  tags,
  selectedTags,
  onTagSelect,
  collections,
  selectedCollection,
  onCollectionSelect,
}: {
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  dateBucket: DateBucket;
  onDateBucketChange: (bucket: DateBucket) => void;
  agents: AgentStats[];
  selectedAgent: string | undefined;
  onAgentSelect: (agent: string | undefined) => void;
  tags?: Array<{ _id: string; name: string; color?: string }>;
  selectedTags?: string[];
  onTagSelect?: (tagIds: string[]) => void;
  collections?: Array<{ _id: string; name: string }>;
  selectedCollection?: string;
  onCollectionSelect?: (id: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={labelClass}>Sort by</div>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className={selectClass}
        >
          <option value="updatedAt">Last modified</option>
          <option value="createdAt">Date created</option>
          <option value="title">Title</option>
        </select>
      </div>

      <div>
        <div className={labelClass}>Date range</div>
        <div className="flex gap-1 px-1">
          {(
            [
              ['all', 'All'],
              ['today', '1d'],
              ['7d', '7d'],
              ['30d', '30d'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => onDateBucketChange(value)}
              className="flex-1 py-1 rounded-[6px] border-0 text-[11.5px] font-[inherit] cursor-pointer"
              style={{
                background: dateBucket === value ? 'var(--active)' : 'transparent',
                color: dateBucket === value ? 'var(--text)' : 'var(--secondary)',
                fontWeight: dateBucket === value ? 550 : 450,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <AgentFilter agents={agents} selected={selectedAgent} onSelect={onAgentSelect} />

      {tags && onTagSelect && (
        <div>
          <div className={labelClass}>Tags</div>
          <div className="flex flex-col gap-0.5 px-1">
            {tags.length === 0 ? (
              <div className="text-[11.5px] text-tertiary p-[2px_4px]">No tags</div>
            ) : (
              tags.map((tag) => {
                const active = selectedTags?.includes(tag._id) ?? false;
                return (
                  <button
                    type="button"
                    key={tag._id}
                    onClick={() => {
                      const current = selectedTags ?? [];
                      onTagSelect(
                        active ? current.filter((id) => id !== tag._id) : [...current, tag._id],
                      );
                    }}
                    className="flex items-center gap-[6px] w-full p-1 rounded-[5px] border-0 font-[inherit] text-[11.5px] cursor-pointer text-left"
                    style={{
                      background: active ? 'var(--active)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--secondary)',
                      fontWeight: active ? 550 : 450,
                    }}
                  >
                    <span
                      className="w-[7px] h-[7px] rounded-full shrink-0"
                      style={{ background: tag.color || 'var(--tertiary)' }}
                    />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {tag.name}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {collections && onCollectionSelect && (
        <div>
          <div className={labelClass}>Collection</div>
          <select
            value={selectedCollection ?? ''}
            onChange={(e) => onCollectionSelect(e.target.value || undefined)}
            className={selectClass}
          >
            <option value="">All plans</option>
            {collections.map((col) => (
              <option key={col._id} value={col._id}>
                {col.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
