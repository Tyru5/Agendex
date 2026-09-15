export const ENCRYPTED_CLOUD_USAGE_UNAVAILABLE =
  'Cloud usage statistics are unavailable with Obfuscation. Local usage statistics still work.';

/** Unknown policy is not permission to query or display cached usage. */
export function cloudUsageUnavailableReason(
  status: { settings: { state: string } | null } | null | undefined,
): string | undefined {
  if (!status) return 'Checking cloud usage availability…';
  return status.settings && status.settings.state !== 'disabled'
    ? ENCRYPTED_CLOUD_USAGE_UNAVAILABLE
    : undefined;
}
