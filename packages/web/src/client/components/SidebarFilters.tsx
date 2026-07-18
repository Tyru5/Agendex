import { useMemo } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import {
  deriveFilterChips,
  type PlanDateBucket,
  type PlanFilterChip,
} from '../lib/plan-filters.ts';
import { AgentFilter } from './AgentFilter.tsx';
import { PlanSearchField } from './PlanSearchField.tsx';

export type SidebarSortBy = 'updatedAt' | 'createdAt' | 'title';

type TagOption = { _id: string; name: string; color?: string };
type CollectionOption = { _id: string; name: string };

const SORT_OPTIONS: Array<{ value: SidebarSortBy; label: string; chip: string }> = [
  { value: 'updatedAt', label: 'Last modified', chip: 'Modified' },
  { value: 'createdAt', label: 'Date created', chip: 'Created' },
  { value: 'title', label: 'Title', chip: 'Title' },
];

const DATE_OPTIONS: Array<{ value: PlanDateBucket; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: '1d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

type ActiveChip =
  | PlanFilterChip
  | {
      key: 'sort';
      kind: 'sort';
      value: SidebarSortBy;
      label: string;
    };

export type SidebarFiltersProps = {
  search: string;
  onSearch: (value: string) => void;
  sortBy: SidebarSortBy;
  onSortChange: (sort: SidebarSortBy) => void;
  dateBucket: PlanDateBucket;
  onDateBucketChange: (bucket: PlanDateBucket) => void;
  agents: AgentStats[];
  selectedAgents: readonly string[];
  onAgentsChange: (agents: string[]) => void;
  workspace?: string;
  onWorkspaceChange?: (workspace: string | undefined) => void;
  workspaces?: readonly string[];
  tags?: TagOption[];
  selectedTags?: readonly string[];
  onTagSelect?: (tagIds: string[]) => void;
  collections?: CollectionOption[];
  selectedCollection?: string;
  onCollectionSelect?: (id: string | undefined) => void;
  onClearAll?: () => void;
  onSearchFocusRequest?: () => void;
};

export function SidebarFilters({
  search,
  onSearch,
  sortBy,
  onSortChange,
  dateBucket,
  onDateBucketChange,
  agents,
  selectedAgents,
  onAgentsChange,
  workspace,
  onWorkspaceChange,
  workspaces = [],
  tags,
  selectedTags,
  onTagSelect,
  collections,
  selectedCollection,
  onCollectionSelect,
  onClearAll,
  onSearchFocusRequest,
}: SidebarFiltersProps) {
  const selectedTagIds = useMemo(() => selectedTags ?? [], [selectedTags]);
  const selectedTagSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const selectedCollectionRecord = collections?.find((col) => col._id === selectedCollection);

  const labelMaps = useMemo(() => {
    return {
      agents: new Map(agents.map((agent) => [agent.agent, getAgentLabel(agent.agent)])),
      tags: new Map(tags?.map((tag) => [tag._id, tag.name]) ?? []),
      collections: new Map(
        collections?.map((collection) => [collection._id, collection.name]) ?? [],
      ),
    };
  }, [agents, collections, tags]);

  const activeChips = useMemo<ActiveChip[]>(() => {
    const chips: ActiveChip[] = deriveFilterChips(
      {
        q: search,
        agents: selectedAgents,
        workspace,
        date: dateBucket,
        tagIds: selectedTagIds,
        collectionId: selectedCollection,
      },
      labelMaps,
    );
    if (sortBy !== 'updatedAt') {
      chips.push({
        key: 'sort',
        kind: 'sort',
        value: sortBy,
        label: SORT_OPTIONS.find((option) => option.value === sortBy)?.chip ?? 'Sort',
      });
    }
    return chips;
  }, [
    dateBucket,
    labelMaps,
    search,
    selectedAgents,
    selectedCollection,
    selectedTagIds,
    sortBy,
    workspace,
  ]);

  const showTags = Boolean(onTagSelect && tags && (tags.length > 0 || selectedTagIds.length > 0));
  const showCollections = Boolean(
    onCollectionSelect && collections && (collections.length > 0 || selectedCollection),
  );
  const showMoreFilters = showTags || showCollections;

  function removeChip(chip: ActiveChip) {
    switch (chip.kind) {
      case 'search':
        onSearch('');
        return;
      case 'agent':
        onAgentsChange(selectedAgents.filter((agent) => agent !== chip.value));
        return;
      case 'workspace':
        onWorkspaceChange?.(undefined);
        return;
      case 'date':
        onDateBucketChange('all');
        return;
      case 'tag':
        onTagSelect?.(selectedTagIds.filter((tagId) => tagId !== chip.value));
        return;
      case 'collection':
        onCollectionSelect?.(undefined);
        return;
      case 'sort':
        onSortChange('updatedAt');
        return;
    }
  }

  function clearAll() {
    if (onClearAll) {
      onClearAll();
      return;
    }
    onSearch('');
    onAgentsChange([]);
    onWorkspaceChange?.(undefined);
    onDateBucketChange('all');
    onSortChange('updatedAt');
    onTagSelect?.([]);
    onCollectionSelect?.(undefined);
  }

  return (
    <div className="sidebar-filter-panel">
      <PlanSearchField search={search} onSearch={onSearch} onFocusRequest={onSearchFocusRequest} />

      {activeChips.length > 0 && (
        <div className="sidebar-active-filters" aria-label="Active filters">
          <div className="sidebar-active-chip-row">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="sidebar-filter-chip sidebar-filter-chip--active sidebar-filter-chip--removable"
                onClick={() => removeChip(chip)}
                title={`Remove ${chip.label}`}
              >
                <span>{chip.label}</span>
                <CloseIcon />
              </button>
            ))}
          </div>
          <button type="button" className="sidebar-section-action" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}

      <AgentFilter agents={agents} selected={selectedAgents} onChange={onAgentsChange} />

      <div className="sidebar-control-block">
        <div className="sidebar-control-header">
          <span className="sidebar-control-label">Workspace</span>
        </div>
        <select
          value={workspace ?? ''}
          onChange={(event) => onWorkspaceChange?.(event.target.value || undefined)}
          className="sidebar-select"
          aria-label="Workspace"
          disabled={!onWorkspaceChange}
        >
          <option value="">All workspaces</option>
          {workspace && !workspaces.includes(workspace) && (
            <option value={workspace}>{workspace}</option>
          )}
          {workspaces.map((workspaceOption) => (
            <option key={workspaceOption} value={workspaceOption}>
              {workspaceOption}
            </option>
          ))}
        </select>
      </div>

      <div className="sidebar-control-block">
        <div className="sidebar-control-header">
          <span className="sidebar-control-label">Date</span>
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

      <div className="sidebar-control-block">
        <div className="sidebar-control-header">
          <span className="sidebar-control-label">Sort</span>
        </div>
        <select
          value={sortBy}
          onChange={(event) => onSortChange(event.target.value as SidebarSortBy)}
          className="sidebar-select"
          aria-label="Sort plans"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {showMoreFilters && (
        <details className="sidebar-more-filters">
          <summary>More filters</summary>
          <div className="sidebar-more-filter-body">
            {showTags && onTagSelect && tags && (
              <div className="sidebar-control-block">
                <div className="sidebar-control-header">
                  <span className="sidebar-control-label">Tags</span>
                  {selectedTagIds.length > 0 && (
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
                  {tags.length === 0 && selectedTagIds.length > 0 && (
                    <button
                      type="button"
                      className="sidebar-compact-row sidebar-compact-row--active"
                      onClick={() => onTagSelect([])}
                    >
                      <span className="sidebar-compact-label">
                        {plural(selectedTagIds.length, 'tag')} selected
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
                  onChange={(event) => onCollectionSelect(event.target.value || undefined)}
                  className="sidebar-select"
                  aria-label="Collection"
                >
                  <option value="">All plans</option>
                  {selectedCollection && !selectedCollectionRecord && (
                    <option value={selectedCollection}>Selected collection</option>
                  )}
                  {collections.map((collection) => (
                    <option key={collection._id} value={collection._id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function plural(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
