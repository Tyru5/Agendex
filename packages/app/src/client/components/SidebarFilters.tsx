import type { AgentStats } from '../lib/api.ts';
import { AgentFilter } from './AgentFilter.tsx';

type SortBy = 'updatedAt' | 'createdAt' | 'title';
type DateBucket = 'all' | 'today' | '7d' | '30d';

const labelStyle = {
  fontSize: '11px',
  fontWeight: 550,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--tertiary)',
  padding: '0 8px',
  marginBottom: '4px',
};

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
        <div style={labelStyle}>Sort by</div>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          style={{
            width: '100%',
            padding: '5px 8px',
            borderRadius: '7px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '12.5px',
            fontFamily: 'inherit',
            fontWeight: 450,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="updatedAt">Last modified</option>
          <option value="createdAt">Date created</option>
          <option value="title">Title</option>
        </select>
      </div>

      <div>
        <div style={labelStyle}>Date range</div>
        <div className="flex gap-1" style={{ padding: '0 4px' }}>
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
              style={{
                flex: 1,
                padding: '4px 0',
                borderRadius: '6px',
                border: 'none',
                background: dateBucket === value ? 'var(--active)' : 'transparent',
                color: dateBucket === value ? 'var(--text)' : 'var(--secondary)',
                fontSize: '11.5px',
                fontFamily: 'inherit',
                fontWeight: dateBucket === value ? 550 : 450,
                cursor: 'pointer',
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
          <div style={labelStyle}>Tags</div>
          <div className="flex flex-col gap-0.5" style={{ padding: '0 4px' }}>
            {tags.length === 0 ? (
              <div style={{ fontSize: '11.5px', color: 'var(--tertiary)', padding: '2px 4px' }}>
                No tags
              </div>
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '4px 4px',
                      borderRadius: '5px',
                      border: 'none',
                      background: active ? 'var(--active)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--secondary)',
                      fontSize: '11.5px',
                      fontFamily: 'inherit',
                      fontWeight: active ? 550 : 450,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: tag.color || 'var(--tertiary)',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
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
          <div style={labelStyle}>Collection</div>
          <select
            value={selectedCollection ?? ''}
            onChange={(e) => onCollectionSelect(e.target.value || undefined)}
            style={{
              width: '100%',
              padding: '5px 8px',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '12.5px',
              fontFamily: 'inherit',
              fontWeight: 450,
              cursor: 'pointer',
              outline: 'none',
            }}
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
