import type { Plan } from './api.ts';
import { filterPlans } from './plan-search.ts';

export type PlanDateBucket = 'all' | 'today' | '7d' | '30d';

export type PlanTagMembership = {
  _id: string;
};

type LabelRecord = Readonly<Record<string, string>>;
type LabelLookup = ReadonlyMap<string, string> | LabelRecord;
type PlanTagsById =
  | ReadonlyMap<string, readonly PlanTagMembership[]>
  | Readonly<Record<string, readonly PlanTagMembership[]>>;

export type PlanFilterState = {
  q?: string;
  agents?: readonly string[];
  workspace?: string;
  date?: PlanDateBucket;
  tagIds?: readonly string[];
  collectionId?: string;
  contentMatchIds?: ReadonlySet<string>;
  planTagsById?: PlanTagsById;
  collectionMemberIds?: ReadonlySet<string>;
};

export type PlanFilterChipKind = 'search' | 'agent' | 'workspace' | 'date' | 'tag' | 'collection';

export type PlanFilterChip = {
  key: string;
  kind: PlanFilterChipKind;
  value: string;
  label: string;
};

export type PlanFilterChipLabels = {
  agents?: LabelLookup;
  workspaces?: LabelLookup;
  tags?: LabelLookup;
  collections?: LabelLookup;
  dates?: Partial<Record<Exclude<PlanDateBucket, 'all'>, string>>;
};

const DATE_BUCKET_MS: Record<Exclude<PlanDateBucket, 'all'>, number> = {
  today: 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const DATE_CHIP_LABELS: Record<Exclude<PlanDateBucket, 'all'>, string> = {
  today: '1d',
  '7d': '7d',
  '30d': '30d',
};

export function applyPlanFilters(plans: Plan[], state: PlanFilterState): Plan[] {
  let result = filterPlans(plans, state.q ?? '', state.contentMatchIds);

  const agents = nonEmptyValues(state.agents);
  if (agents.length > 0) {
    const agentSet = new Set(agents);
    result = result.filter((plan) => agentSet.has(plan.agent));
  }

  const workspace = normalizeValue(state.workspace);
  if (workspace) {
    result = result.filter((plan) => normalizeValue(plan.workspace) === workspace);
  }

  const date = state.date ?? 'all';
  if (date !== 'all') {
    const cutoff = Date.now() - DATE_BUCKET_MS[date];
    result = result.filter((plan) => new Date(plan.updatedAt).getTime() >= cutoff);
  }

  const tagIds = nonEmptyValues(state.tagIds);
  const planTagsById = state.planTagsById;
  if (tagIds.length > 0 && planTagsById) {
    const selectedTags = new Set(tagIds);
    result = result.filter((plan) =>
      getPlanTags(planTagsById, plan.id).some((tag) => selectedTags.has(tag._id)),
    );
  }

  const collectionId = normalizeValue(state.collectionId);
  const collectionMemberIds = state.collectionMemberIds;
  if (collectionId && collectionMemberIds) {
    result = result.filter((plan) => collectionMemberIds.has(plan.id));
  }

  return result;
}

export function deriveFilterChips(
  state: PlanFilterState,
  labels: PlanFilterChipLabels = {},
): PlanFilterChip[] {
  const chips: PlanFilterChip[] = [];
  const query = normalizeValue(state.q);
  if (query) {
    chips.push({ key: 'search', kind: 'search', value: query, label: query });
  }

  for (const agent of nonEmptyValues(state.agents)) {
    chips.push({
      key: `agent:${agent}`,
      kind: 'agent',
      value: agent,
      label: labelFor(labels.agents, agent),
    });
  }

  const workspace = normalizeValue(state.workspace);
  if (workspace) {
    chips.push({
      key: `workspace:${workspace}`,
      kind: 'workspace',
      value: workspace,
      label: labelFor(labels.workspaces, workspace),
    });
  }

  const date = state.date ?? 'all';
  if (date !== 'all') {
    chips.push({
      key: `date:${date}`,
      kind: 'date',
      value: date,
      label: labels.dates?.[date] ?? DATE_CHIP_LABELS[date],
    });
  }

  for (const tagId of nonEmptyValues(state.tagIds)) {
    chips.push({
      key: `tag:${tagId}`,
      kind: 'tag',
      value: tagId,
      label: labelFor(labels.tags, tagId),
    });
  }

  const collectionId = normalizeValue(state.collectionId);
  if (collectionId) {
    chips.push({
      key: `collection:${collectionId}`,
      kind: 'collection',
      value: collectionId,
      label: labelFor(labels.collections, collectionId),
    });
  }

  return chips;
}

export function workspacesFromPlans(plans: readonly Plan[]): string[] {
  return [...new Set(plans.map((plan) => normalizeValue(plan.workspace)).filter(isNonEmpty))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function getPlanTags(planTagsById: PlanTagsById, planId: string): readonly PlanTagMembership[] {
  if (planTagsById instanceof Map) return planTagsById.get(planId) ?? [];
  const planTagsRecord = planTagsById as Readonly<Record<string, readonly PlanTagMembership[]>>;
  return planTagsRecord[planId] ?? [];
}

function labelFor(labels: LabelLookup | undefined, value: string): string {
  if (!labels) return value;
  if (labels instanceof Map) return labels.get(value) ?? value;
  const labelRecord = labels as LabelRecord;
  return labelRecord[value] ?? value;
}

function nonEmptyValues(values: readonly string[] | undefined): string[] {
  return values?.map(normalizeValue).filter(isNonEmpty) ?? [];
}

function normalizeValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

function isNonEmpty(value: string): value is string {
  return value.length > 0;
}
