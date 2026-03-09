// Keep the CLI heartbeat conservative to avoid unnecessary Convex write volume.
export const CLI_DAEMON_HEARTBEAT_INTERVAL_MS = 30_000;
export const CLI_DAEMON_STALE_AFTER_MS = CLI_DAEMON_HEARTBEAT_INTERVAL_MS * 3;
export const CLI_DAEMON_STATUS_POLL_INTERVAL_MS = 15_000;
