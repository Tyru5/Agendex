// Keep the CLI heartbeat conservative to avoid unnecessary Convex write volume.
export const CLI_DAEMON_HEARTBEAT_INTERVAL_MS = 30_000;
// Use a generous multiplier to tolerate network latency, event-loop delays,
// Convex mutation queuing, and client/server clock skew.
export const CLI_DAEMON_STALE_AFTER_MS = CLI_DAEMON_HEARTBEAT_INTERVAL_MS * 5;
export const CLI_DAEMON_STATUS_POLL_INTERVAL_MS = 15_000;
