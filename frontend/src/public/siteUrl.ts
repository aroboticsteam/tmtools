/**
 * The downloadable static copy of the public site (Settings -> export, see
 * backend/modules/site_export.py) is this same SPA with `window.__SITE_STATIC__` set in its
 * index.html. There the site's data comes from `data/<path>.json` snapshots instead of the API,
 * and the pages that need the live server (match alerts) are hidden.
 */
export const STATIC_SITE = typeof window !== 'undefined' && (window as unknown as { __SITE_STATIC__?: boolean }).__SITE_STATIC__ === true;

export function siteDataUrl(path: string): string {
  return STATIC_SITE ? `data/${path}.json` : `/api/v1/public/site/${path}`;
}
