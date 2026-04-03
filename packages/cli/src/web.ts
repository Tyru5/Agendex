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
