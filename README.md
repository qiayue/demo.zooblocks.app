# WebGame Template

A SEO-friendly online game website template, deployable to Cloudflare Workers with one click. No coding required — manage everything from a built-in admin that commits content to GitHub, which automatically redeploys your site.

## Features

- **SEO-first**: server-rendered HTML, automatic `<title>`, `<meta>`, `hreflang`, JSON-LD (VideoGame / Article / FAQ / Breadcrumb), `sitemap.xml`, `robots.txt`.
- **Composable pages**: every page is built from a small set of reusable modules — game iframe, video iframe, page list, and SEO content blocks (intro, features grid, steps, screenshots, pros/cons, FAQ, text+image, rich text).
- **Click-to-load iframes**: game and video URLs are present in the rendered HTML for crawlers, but the iframe only mounts when the user clicks play.
- **Multilingual**: each page version is independent and linked via an `alternateKey`. The default language is served at `/`, other languages under `/{lang}/`.
- **Built-in admin** at `/admin`: password-protected, edits are saved as commits to your GitHub repo (which triggers automatic redeploy on Cloudflare).
- **R2 image uploads** with signed upload tokens.
- **AdSense auto ads** (single config field).

## Routes

| Type     | URL pattern              |
| -------- | ------------------------ |
| Home     | `/` or `/{lang}/`        |
| Game     | `/g/{slug}`              |
| Tag      | `/t/{slug}`              |
| Guide    | `/p/{slug}`              |
| Sitemap  | `/sitemap.xml`           |
| Robots   | `/robots.txt`            |
| Admin    | `/admin`                 |

The default language is served at the root (no `/{lang}` prefix); requesting `/{defaultLang}/...` issues a 301 redirect to the un-prefixed URL.

## One-click deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/qiayue/webgame)

After the fork & deploy:

1. **Create a GitHub Personal Access Token** with `contents: read & write` on the forked repo. (https://github.com/settings/tokens?type=beta — "Fine-grained tokens" → Repository access: only the forked repo → Permissions: Contents (read & write).)
2. **Create an R2 bucket** in the Cloudflare dashboard (default name: `webgame-uploads`) and bind it to your Worker. Configure a public custom domain or `r2.dev` URL for the bucket.
3. **Set Worker secrets** (Workers & Pages → your worker → Settings → Variables and Secrets):
   - `ADMIN_PASSWORD` — your admin login password.
   - `ADMIN_SESSION_SECRET` — random string for signing session cookies.
   - `GITHUB_TOKEN` — the PAT from step 1.
   - `R2_UPLOAD_SECRET` — random string for signing upload tokens.
4. **Set environment variables**:
   - `GITHUB_REPO` — `owner/repo` of the forked repo.
   - `GITHUB_BRANCH` — usually `main`.
   - `R2_PUBLIC_BASE_URL` — the public base URL of your R2 bucket (no trailing slash).
5. Visit `/admin` on your deployed Worker, sign in, and start adding content.

## Local development

```bash
npm install
npm run watch:css   # in one terminal
npm run dev         # in another
```

Create a `.dev.vars` file in the project root with the same secrets as above to test admin / GitHub features locally.

## Content structure

```
content/
  site.json              # site name, languages, menu, footer, ads, analytics
  index.json             # auto-generated page index (do not edit by hand)
  _page-files.ts         # auto-generated import registry (do not edit by hand)
  i18n/
    en.json              # UI strings per language
    zh.json
  pages/
    home/
      en.json            # homepage per language
    g/{lang}/{slug}.json # game pages
    t/{lang}/{slug}.json # tag pages
    p/{lang}/{slug}.json # guide pages
```

You normally don't need to touch these files directly — the admin edits them for you and commits the changes to GitHub.

## Page modules

| Module          | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `game-iframe`   | First-screen game splash + click-to-load iframe.              |
| `video-iframe`  | YouTube embed splash + click-to-load iframe (for guides).     |
| `page-list`     | List of pages (latest / related / by tag / manual).           |
| `seo-content`   | Structured SEO content. Variants: intro, rich-text, features-grid, steps, screenshots, pros-cons, faq, text-image. |

Every page must contain at least one `seo-content` module for SEO purposes (the admin will warn you if it doesn't).

## Architecture

- **No framework**: plain TypeScript + tagged-template HTML on the server, Tailwind CSS for styles, vanilla JS for the admin SPA.
- **Data flow**: admin → Worker `/admin/api` → GitHub Contents API → CF auto-deploys → JSON re-bundled into the next version.
- **Security**: HMAC-signed session cookies (HttpOnly, SameSite=Strict), CSRF header on all writes, signed upload tokens for R2, per-IP login rate limiting.

## License

MIT
