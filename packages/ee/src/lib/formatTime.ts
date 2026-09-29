/** Short relative label from a Unix ms timestamp (e.g. `just now`, `3m ago`). */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const timeAgo = formatRelativeTime;

/** Share-link expiry label, e.g. `Expires in 6 days`, `Expires in 3 hours`, `No expiry`. */
export function formatShareLinkExpiry(expiresAt: number | undefined, now: number = Date.now()) {
  if (expiresAt === undefined) return 'No expiry';
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const hours = Math.ceil(diff / 3_600_000);
  if (hours < 24) return hours === 1 ? 'Expires in 1 hour' : `Expires in ${hours} hours`;
  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`;
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
