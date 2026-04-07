import { getDefaultSiteUrl, openBrowser } from './auth.ts';

/**
 * Opens the Agendex web app in the system browser (same base URL rules as `agendex login`).
 */
export async function openAgendexWeb(siteUrlOverride?: string): Promise<void> {
  const base = siteUrlOverride ?? getDefaultSiteUrl();
  const url = base.replace(/\/$/, '');

  console.log('[agendex] Opening Agendex in your browser...');
  console.log(`[agendex] If it doesn't open, visit: ${url}`);

  if (process.env.AGENDEX_DISABLE_BROWSER === '1') {
    console.log('[agendex] Browser launch disabled by AGENDEX_DISABLE_BROWSER=1.');
  } else {
    openBrowser(url);
  }
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

  console.log('[agendex] Opening shared plan in your browser...');
  console.log(`[agendex] If it doesn't open, visit: ${url}`);

  if (process.env.AGENDEX_DISABLE_BROWSER === '1') {
    console.log('[agendex] Browser launch disabled by AGENDEX_DISABLE_BROWSER=1.');
  } else {
    openBrowser(url);
  }
}
