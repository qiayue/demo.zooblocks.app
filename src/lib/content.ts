import type {
  Env,
  PageDetail,
  PageIndex,
  PageIndexEntry,
  PageType,
  SiteConfig,
  UiStrings,
} from '../types';

// ---------------------------------------------------------------------------
// Content loading
//
// Content is bundled into the Worker via the `[[rules]] type = "Text"` in
// wrangler.toml. Each JSON file becomes an importable module exposing its
// raw text as the default export.
// ---------------------------------------------------------------------------

import siteJson from '../../content/site.json';
import indexJson from '../../content/index.json';

// I18n files (UI strings). Add new languages by creating a new file and
// registering it here.
import enStrings from '../../content/i18n/en.json';
import zhStrings from '../../content/i18n/zh.json';

const uiStringsByLang: Record<string, UiStrings> = {
  en: parseJson<UiStrings>(enStrings),
  zh: parseJson<UiStrings>(zhStrings),
};

// Page detail JSON files. We use Vite-like glob imports so adding a new page
// only requires dropping a JSON file into content/pages/...
// Cloudflare's Workers bundler (esbuild) doesn't support import.meta.glob, so
// we explicitly enumerate via a generated index. For now we eagerly import a
// known set; the content index acts as the source of truth and we read the
// detail JSON lazily through a registry.
import pageFiles from '../../content/_page-files';

const pageRegistry: Record<string, PageDetail> = {};
for (const [key, raw] of Object.entries(pageFiles)) {
  pageRegistry[key] = parseJson<PageDetail>(raw);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let cachedSite: SiteConfig | null = null;
export function getSite(): SiteConfig {
  if (!cachedSite) cachedSite = parseJson<SiteConfig>(siteJson);
  return cachedSite;
}

let cachedIndex: PageIndex | null = null;
export function getIndex(): PageIndex {
  if (!cachedIndex) cachedIndex = parseJson<PageIndex>(indexJson);
  return cachedIndex;
}

export function getUiStrings(lang: string): UiStrings {
  const site = getSite();
  return uiStringsByLang[lang] ?? uiStringsByLang[site.defaultLang] ?? uiStringsByLang.en!;
}

export function getPage(type: PageType, lang: string, slug: string): PageDetail | null {
  const key = pageKey(type, lang, slug);
  return pageRegistry[key] ?? null;
}

export function pageKey(type: PageType, lang: string, slug: string): string {
  return `${type}/${lang}/${slug}`;
}

// ---------------------------------------------------------------------------
// Index queries
// ---------------------------------------------------------------------------

export interface ListQuery {
  type?: PageType | PageType[];
  tag?: string;
  lang: string;
  limit?: number;
  excludeSlug?: string;
  excludeType?: PageType;
}

export function listPages(q: ListQuery): PageIndexEntry[] {
  const { entries } = getIndex();
  const types = q.type ? (Array.isArray(q.type) ? q.type : [q.type]) : null;

  let result = entries.filter((e) => {
    if (e.lang !== q.lang) return false;
    if (types && !types.includes(e.type)) return false;
    if (q.tag && !e.tags.includes(q.tag)) return false;
    if (q.excludeSlug && q.excludeType && e.slug === q.excludeSlug && e.type === q.excludeType) {
      return false;
    }
    return true;
  });

  // Newest first by publishedAt.
  result.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  if (q.limit && q.limit > 0) result = result.slice(0, q.limit);
  return result;
}

export function listRelated(
  page: Pick<PageDetail, 'type' | 'lang' | 'slug' | 'tags'>,
  opts: { limit?: number; type?: PageType | PageType[] } = {},
): PageIndexEntry[] {
  const { entries } = getIndex();
  const limit = opts.limit ?? 8;
  const types = opts.type ? (Array.isArray(opts.type) ? opts.type : [opts.type]) : null;
  const tagSet = new Set(page.tags);

  const scored = entries
    .filter((e) => {
      if (e.lang !== page.lang) return false;
      if (e.slug === page.slug && e.type === page.type) return false;
      if (types && !types.includes(e.type)) return false;
      return e.tags.some((t) => tagSet.has(t));
    })
    .map((e) => {
      const overlap = e.tags.filter((t) => tagSet.has(t)).length;
      return { entry: e, overlap };
    })
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return a.entry.publishedAt < b.entry.publishedAt ? 1 : -1;
    })
    .slice(0, limit)
    .map((s) => s.entry);

  return scored;
}

export function findAlternates(key: string | undefined, currentLang: string) {
  if (!key) return [];
  return getIndex().entries.filter((e) => e.alternateKey === key && e.lang !== currentLang);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseJson<T>(raw: unknown): T {
  if (typeof raw === 'string') return JSON.parse(raw) as T;
  return raw as T;
}

// Allow the admin/data layer to invalidate the in-memory cache (not used
// during normal SSR, but kept for future use).
export function _resetCache() {
  cachedSite = null;
  cachedIndex = null;
}

// Re-export env for convenience
export type { Env };
