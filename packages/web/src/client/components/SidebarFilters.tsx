import { useId, useMemo, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentFilter } from './AgentFilter.tsx';

type SortBy = 'updatedAt' | 'createdAt' | 'title';
type DateBucket = 'all' | 'today' | '7d' | '30d';

type TagOption = { _id: string; name: string; color?: string };
type CollectionOption = { _id: string; name: string };

const SORT_OPTIONS: Array<{ value: SortBy; label: string; chip: string }> = [
  { value: 'updatedAt', label: 'Last modified', chip: 'Modified' },
  { value: 'createdAt', label: 'Date created', chip: 'Created' },
  { value: 'title', label: 'Title', chip: 'Title' },
];

const DATE_OPTIONS: Array<{ value: DateBucket; label: string; chip: string }> = [
  { value: 'all', label: 'All time', chip: 'Any time' },
  { value: 'today', label: '1d', chip: '1d' },
  { value: '7d', label: '7d', chip: '7d' },
  { value: '30d', label: '30d', chip: '30d' },
];

function SlidersIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M2 4h7" />
      <path d="M12 4h2" />
      <path d="M2 12h2" />
      <path d="M7 12h7" />
      <circle cx="10.5" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="sidebar-filter-chevron"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function plural(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

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
  tags?: TagOption[];
  selectedTags?: string[];
  onTagSelect?: (tagIds: string[]) => void;
  collections?: CollectionOption[];
  selectedCollection?: string;
  onCollectionSelect?: (id: string | undefined) => void;
}) {
  const drawerId = useId();
  const [expanded, setExpanded] = useState(false);

  const selectedTagIds = selectedTags ?? [];
  const selectedTagSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const selectedCollectionRecord = collections?.find((col) => col._id === selectedCollection);
  const selectedAgentLabel = selectedAgent ? getAgentLabel(selectedAgent) : 'All agents';
  const sortChip = SORT_OPTIONS.find((option) => option.value === sortBy)?.chip ?? 'Modified';
  const dateChip = DATE_OPTIONS.find((option) => option.value === dateBucket)?.chip ?? 'Any time';
  const selectedTagCount = selectedTagIds.length;

  const showTags = Boolean(onTagSelect && tags && (tags.length > 0 || selectedTagCount > 0));
  const showCollections = Boolean(
    onCollectionSelect && collections && (collections.length > 0 || selectedCollection),
  );

  const chips = [
    { key: 'sort', label: sortChip, active: sortBy !== 'updatedAt', optional: false },
    { key: 'date', label: dateChip, active: dateBucket !== 'all', optional: false },
    { key: 'agent', label: selectedAgentLabel, active: Boolean(selectedAgent), optional: true },
    ...(selectedTagCount > 0
      ? [
          {
            key: 'tags',
            label: plural(selectedTagCount, 'tag'),
            active: true,
            optional: false,
          },
        ]
      : []),
    ...(selectedCollection
      ? [
          {
            key: 'collection',
            label: selectedCollectionRecord?.name ?? 'Collection',
            active: true,
            optional: false,
          },
        ]
      : []),
  ];

  return (
    <div className="sidebar-filter-card">
      <button
        type="button"
        className="sidebar-filter-summary"
        data-expanded={expanded}
        aria-expanded={expanded}
        aria-controls={drawerId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="sidebar-summary-icon">
          <SlidersIcon />
        </span>
        <span className="sidebar-filter-title">Filters</span>
        <span className="sidebar-filter-chips" aria-hidden="true">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={`sidebar-filter-chip${chip.active ? ' sidebar-filter-chip--active' : ''}${
                chip.optional ? ' sidebar-filter-chip--optional' : ''
              }`}
              title={chip.label}
            >
              {chip.label}
            </span>
          ))}
        </span>
        <ChevronDownIcon />
      </button>

      {expanded && (
        <div id={drawerId} className="sidebar-filter-drawer">
          <div className="sidebar-control-block">
            <div className="sidebar-control-header">
              <span className="sidebar-control-label">Sort</span>
            </div>
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as SortBy)}
              className="sidebar-select"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sidebar-control-block">
            <div className="sidebar-control-header">
              <span className="sidebar-control-label">Date range</span>
            </div>
            <fieldset className="sidebar-segmented" aria-label="Date range">
              {DATE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => onDateBucketChange(option.value)}
                  className={`sidebar-segment${dateBucket === option.value ? ' sidebar-segment--active' : ''}`}
                  aria-pressed={dateBucket === option.value}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          </div>

          <AgentFilter agents={agents} selected={selectedAgent} onSelect={onAgentSelect} />

          {showTags && onTagSelect && tags && (
            <div className="sidebar-control-block">
              <div className="sidebar-control-header">
                <span className="sidebar-control-label">Tags</span>
                {selectedTagCount > 0 && (
                  <button
                    type="button"
                    className="sidebar-section-action"
                    onClick={() => onTagSelect([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="sidebar-list-stack">
                {tags.map((tag) => {
                  const active = selectedTagSet.has(tag._id);
                  return (
                    <button
                      type="button"
                      key={tag._id}
                      onClick={() => {
                        onTagSelect(
                          active
                            ? selectedTagIds.filter((id) => id !== tag._id)
                            : [...selectedTagIds, tag._id],
                        );
                      }}
                      className={`sidebar-compact-row${active ? ' sidebar-compact-row--active' : ''}`}
                      aria-pressed={active}
                    >
                      <span
                        className="w-[7px] h-[7px] rounded-full shrink-0"
                        style={{ background: tag.color || 'var(--tertiary)' }}
                      />
                      <span className="sidebar-compact-label">{tag.name}</span>
                    </button>
                  );
                })}
                {tags.length === 0 && selectedTagCount > 0 && (
                  <button
                    type="button"
                    className="sidebar-compact-row sidebar-compact-row--active"
                    onClick={() => onTagSelect([])}
                  >
                    <span className="sidebar-compact-label">
                      {plural(selectedTagCount, 'tag')} selected
                    </span>
                    <span className="sidebar-count-pill">Clear</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {showCollections && onCollectionSelect && collections && (
            <div className="sidebar-control-block">
              <div className="sidebar-control-header">
                <span className="sidebar-control-label">Collection</span>
              </div>
              <select
                value={selectedCollection ?? ''}
                onChange={(e) => onCollectionSelect(e.target.value || undefined)}
                className="sidebar-select"
              >
                <option value="">All plans</option>
                {selectedCollection && !selectedCollectionRecord && (
                  <option value={selectedCollection}>Selected collection</option>
                )}
                {collections.map((col) => (
                  <option key={col._id} value={col._id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
