/** Read-content baselines are separate from unread badge timestamps. */
export const MAX_READ_SNAPSHOT_BYTES = 256 * 1024;
export type PlanReadSnapshot = { title: string; content: string; updatedAt: string };
export type PlanReadResult = {
  baseline: PlanReadSnapshot | null;
  reason: 'first-read' | 'available' | 'unavailable' | 'too-large';
};
