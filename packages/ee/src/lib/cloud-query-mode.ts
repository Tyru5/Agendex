export type CloudQueryMode = 'cloud' | 'local';

export function canUseCloudPlanMetadata(mode: CloudQueryMode, isPro: boolean): boolean {
  return mode === 'cloud' && isPro;
}

export function canUseTechDependencyChart(mode: CloudQueryMode, isPro: boolean): boolean {
  return mode === 'cloud' && isPro;
}

export function canManageCustomPlanSources(
  mode: CloudQueryMode,
  isPro: boolean,
  canSwitchMode: boolean,
): boolean {
  return mode === 'local' || (canSwitchMode && canUseCloudPlanMetadata(mode, isPro));
}

export function shouldQueryCloudPlanTags({
  mode,
  isPro,
  selectedTagCount,
  planCount,
}: {
  readonly mode: CloudQueryMode;
  readonly isPro: boolean;
  readonly selectedTagCount: number;
  readonly planCount: number;
}): boolean {
  return canUseCloudPlanMetadata(mode, isPro) && selectedTagCount > 0 && planCount > 0;
}
