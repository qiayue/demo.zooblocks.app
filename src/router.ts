import type { Env } from './types';
import { getSite, getIndex, getPage, getUiStrings } from './lib/content';
import { parsePath, redirectForDefaultLang } from './lib/url';
import { buildRobots, buildSitemap } from './lib/seo';
import { renderPage } from './renderer/page';
import { renderNotFound } from './renderer/notFound';
import { handleAdminApi } from './admin/api';
import { handleLogin, handleLogout } from './admin/login';
import { renderAdminShell } from './admin/ui';

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const origin = url.origin;

  // Static assets (Tailwind CSS, client JS, etc.). With the [assets] binding,
  // Cloudflare usually serves these before the Worker runs, but we forward
  // explicitly as a fallback for `wrangler dev` and any edge cases.
  if (path.startsWith('/assets/') || path === '/favicon.ico') {
    return env.ASSETS.fetch(req);
  }

  // Special routes
  if (path === '/robots.txt') {
    return new Response(buildRobots(origin), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  }
  if (path === '/sitemap.xml') {
    const site = getSite();
    const idx = getIndex();
    return new Response(buildSitemap(site, idx.entries, origin), {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
    });
  }

  // Admin
  if (path === '/admin' || path === '/admin/') {
    return renderAdminShell(env, req);
  }
  if (path === '/admin/login') return handleLogin(req, env);
  if (path === '/admin/logout') return handleLogout(req, env);
  if (path.startsWith('/admin/api/')) return handleAdminApi(req, env);

  // Site pages
  const site = getSite();

  // 301: /{defaultLang}/... -> /...
  const redirectTarget = redirectForDefaultLang(site, path);
  if (redirectTarget !== null) {
    return Response.redirect(origin + redirectTarget + url.search, 301);
  }

  const parsed = parsePath(site, path);
  if (!parsed) {
    const ui = getUiStrings(site.defaultLang);
    return new Response(renderNotFound(site, ui, site.defaultLang), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const page = getPage(parsed.type, parsed.lang, parsed.slug);
  if (!page) {
    const ui = getUiStrings(parsed.lang);
    return new Response(renderNotFound(site, ui, parsed.lang), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const ui = getUiStrings(parsed.lang);
  const html = renderPage({ site, page, ui, origin });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  });
}
