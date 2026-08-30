import type { Infer } from 'convex/values';
import { v } from 'convex/values';

const metadataScalarValidator = v.union(v.string(), v.number(), v.boolean(), v.null());
const metadataArrayValidator = v.array(metadataScalarValidator);
const metadataLevelOneValidator = v.union(
  metadataScalarValidator,
  metadataArrayValidator,
  v.record(v.string(), v.union(metadataScalarValidator, metadataArrayValidator)),
);
const metadataLevelTwoValidator = v.union(
  metadataScalarValidator,
  metadataArrayValidator,
  v.record(v.string(), metadataLevelOneValidator),
);

/**
 * Public plan metadata is bounded to Convex scalar arrays and two nested object
 * levels. This preserves every metadata shape Agendex emits today (including
 * git.repo, plannotator, and agendexSync) without exposing an unvalidated bag.
 */
export const planMetadataValidator = v.record(v.string(), metadataLevelTwoValidator);
export type PlanMetadataDto = Infer<typeof planMetadataValidator>;

type MetadataScalar = string | number | boolean | null;
type MetadataArray = MetadataScalar[];
type MetadataLevelOne = MetadataScalar | MetadataArray | Record<string, MetadataScalar | MetadataArray>;
type MetadataLevelTwo = MetadataScalar | MetadataArray | Record<string, MetadataLevelOne>;

function isMetadataScalar(value: unknown): value is MetadataScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function sanitizeMetadataValue(value: unknown, depth: number): MetadataLevelTwo | undefined {
  if (isMetadataScalar(value)) return value;

  if (Array.isArray(value)) {
    const values: MetadataArray = [];
    for (const item of value) {
      if (!isMetadataScalar(item)) return undefined;
      values.push(item);
    }
    return values;
  }

  if (depth <= 0 || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, MetadataLevelOne> = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeMetadataValue(child, depth - 1);
    if (sanitized !== undefined) result[key] = sanitized as MetadataLevelOne;
  }
  return result;
}

export function toPlanMetadataDto(value: unknown): PlanMetadataDto | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, MetadataLevelTwo> = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeMetadataValue(child, 2);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}
