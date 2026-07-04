import { getSiteUrl, launchBrowser } from './auth.ts';

/**
 * Opens the Agendex web app in the system browser (same base URL rules as `agendex login`).
 * Targets /dashboard (the authenticated app) rather than the site root, which
 * renders the marketing landing page.
 */
export async function openAgendexWeb(siteUrlOverride?: string): Promise<void> {
  const base = siteUrlOverride ?? getSiteUrl();
  const url = `${base.replace(/\/$/, '')}/dashboard`;

  launchBrowser(url, 'Agendex in your browser');
}

/**
 * Opens a shared Agendex plan URL in the system browser.
 * Validates the URL is well-formed and contains the `/shared/` path segment.
 * @returns whether the browser was launched successfully
 */
export async function openSharedPlan(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`[agendex] invalid URL: ${url}`);
    return false;
  }

  if (!parsed.pathname.includes('/shared/')) {
    console.error(`[agendex] not a shared plan URL: ${url}`);
    console.error('[agendex] expected format: https://app.agendex.dev/shared/<token>');
    return false;
  }

  launchBrowser(url, 'shared plan in your browser');
  return true;
}
