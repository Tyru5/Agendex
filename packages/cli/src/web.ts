import { getDefaultSiteUrl, launchBrowser } from './auth.ts';

/**
 * Opens the Agendex web app in the system browser (same base URL rules as `agendex login`).
 */
export async function openAgendexWeb(siteUrlOverride?: string): Promise<void> {
  const base = siteUrlOverride ?? getDefaultSiteUrl();
  const url = base.replace(/\/$/, '');

  launchBrowser(url, 'Agendex in your browser');
}

/**
 * Opens a shared Agendex plan URL in the system browser.
 * Validates the URL is well-formed and contains the `/shared/` path segment.
 */
export async function openSharedPlan(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.log(`[agendex] invalid URL: ${url}`);
    return;
  }

  if (!parsed.pathname.includes('/shared/')) {
    console.log(`[agendex] not a shared plan URL: ${url}`);
    console.log('[agendex] expected format: https://app.agendex.dev/shared/<token>');
    return;
  }

  launchBrowser(url, 'shared plan in your browser');
}
