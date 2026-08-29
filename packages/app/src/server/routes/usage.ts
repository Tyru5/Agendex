import { DEFAULT_USAGE_DAYS, getUsageSummary, type UsageSummary } from '@agendex/shared';
import { Hono } from 'hono';

const usage = new Hono();

/** Serve a recent summary instead of rescanning on every request. */
const SUMMARY_TTL_MS = 5 * 60 * 1000;

let cached: { days: number; at: number; summary: UsageSummary } | null = null;
const inflight = new Map<number, Promise<UsageSummary>>();

usage.get('/usage', async (c) => {
  const daysParam = parseInt(c.req.query('days') ?? '', 10);
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(daysParam, 1), 365)
    : DEFAULT_USAGE_DAYS;
  const refresh = c.req.query('refresh') === '1';

  if (!refresh && cached && cached.days === days && Date.now() - cached.at < SUMMARY_TTL_MS) {
    return c.json(cached.summary);
  }

  // Collapse concurrent scans of the same window into one.
  let scan = inflight.get(days);
  if (!scan) {
    scan = getUsageSummary({ days })
      .then((summary) => {
        cached = { days, at: Date.now(), summary };
        return summary;
      })
      .finally(() => {
        inflight.delete(days);
      });
    inflight.set(days, scan);
  }

  try {
    return c.json(await scan);
  } catch (error) {
    console.error('[agendex] usage scan failed:', error);
    return c.json({ error: 'usage scan failed' }, 500);
  }
});

export { usage };
