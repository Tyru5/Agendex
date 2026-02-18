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
}: {
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  dateBucket: DateBucket;
  onDateBucketChange: (bucket: DateBucket) => void;
  agents: AgentStats[];
  selectedAgent: string | undefined;
  onAgentSelect: (agent: string | undefined) => void;
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
    </div>
  );
}
