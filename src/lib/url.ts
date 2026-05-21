import type { PageType, SiteConfig } from '../types';

/**
 * Build a path for a page given its type, language, and slug.
 *
 * Rules:
 *   - The site's default language is served at the root (no /lang prefix).
 *   - Other languages are served under /{lang}/...
 *   - Home pages have no /g//t//p/ prefix.
 *
 * Examples (defaultLang = "en"):
 *   game,  en, "subway-surfers"  -> /g/subway-surfers
 *   game,  zh, "subway-surfers"  -> /zh/g/subway-surfers
 *   tag,   en, "action"          -> /t/action
 *   guide, ja, "tips"            -> /ja/p/tips
 *   home,  en, "home"            -> /
 *   home,  zh, "home"            -> /zh/
 */
export function pagePath(site: SiteConfig, type: PageType, lang: string, slug: string): string {
  const langPrefix = lang === site.defaultLang ? '' : `/${lang}`;
  if (type === 'home') return langPrefix === '' ? '/' : `${langPrefix}/`;
  const typePrefix = TYPE_PREFIX[type];
  return `${langPrefix}/${typePrefix}/${slug}`;
}

const TYPE_PREFIX: Record<Exclude<PageType, 'home'>, string> = {
  game: 'g',
  tag: 't',
  guide: 'p',
};

/**
 * Parse a request path into a (lang, type, slug) tuple, or null if it doesn't
 * match any page.
 */
export function parsePath(
  site: SiteConfig,
  pathname: string,
): { lang: string; type: PageType; slug: string } | null {
  if (pathname === '/' || pathname === '') {
    return { lang: site.defaultLang, type: 'home', slug: 'home' };
  }

  // Strip a trailing slash for matching (except root, handled above).
  const path = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Optional leading language segment
  let lang = site.defaultLang;
  let rest = segments;
  const knownLangs = new Set(site.languages.map((l) => l.code));
  if (knownLangs.has(segments[0]!)) {
    lang = segments[0]!;
    rest = segments.slice(1);
  }

  // Lang-only path -> home of that language
  if (rest.length === 0) return { lang, type: 'home', slug: 'home' };

  const prefix = rest[0]!;
  const slugSegments = rest.slice(1);
  if (slugSegments.length === 0) return null;
  const slug = slugSegments.join('/');

  for (const [pageType, typePrefix] of Object.entries(TYPE_PREFIX) as [
    Exclude<PageType, 'home'>,
    string,
  ][]) {
    if (prefix === typePrefix) return { lang, type: pageType, slug };
  }

  return null;
}

/** Should this path 301-redirect (e.g. /en when default is "en"). */
export function redirectForDefaultLang(site: SiteConfig, pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0] === site.defaultLang) {
    const rest = '/' + segments.slice(1).join('/');
    return rest === '/' ? '/' : rest;
  }
  return null;
}
