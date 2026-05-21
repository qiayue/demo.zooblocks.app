# WebGame Template

A SEO-friendly online game website template, deployable to Cloudflare Workers with one click. No coding required — manage everything from a built-in admin that commits content to GitHub, which automatically redeploys your site.

## Features

- **SEO-first**: server-rendered HTML, automatic `<title>`, `<meta>`, `hreflang`, JSON-LD (VideoGame / Article / FAQ / Breadcrumb), `sitemap.xml`, `robots.txt`.
- **Composable pages**: every page is built from a small set of reusable modules — game iframe, video iframe, page list, and SEO content blocks (intro, features grid, steps, screenshots, pros/cons, FAQ, text+image, rich text).
- **Click-to-load iframes**: game and video URLs are present in the rendered HTML for crawlers, but the iframe only mounts when the user clicks play.
- **Multilingual**: each page version is independent and linked via an `alternateKey`. The default language is served at `/`, other languages under `/{lang}/`.
- **In-browser setup wizard** at `/setup`: walks you through admin password, GitHub access, and R2 image hosting. No env vars to guess up front.
- **Built-in admin** at `/admin`: edits are saved as commits to your GitHub repo (which triggers automatic redeploy on Cloudflare).
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
| Setup    | `/setup` (first-time wizard) |
| Admin    | `/admin`                 |

The default language is served at the root (no `/{lang}` prefix); requesting `/{defaultLang}/...` issues a 301 redirect to the un-prefixed URL.

## How deployment works (≈10 minutes, no coding)

1. **Click "Deploy to Cloudflare"** (button below). Cloudflare will:
   - fork this repository to your own GitHub,
   - create a new Worker, and
   - automatically create an R2 bucket named `webgame-uploads`.

   You do **not** need to fill any environment variables here — leave everything blank and click deploy.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/qiayue/webgame)

2. **Open your new Worker URL.** It will redirect you to `/setup` — a wizard that walks you through:

   - **Step 1 — Admin password.** Pick a strong password.

   - **Step 2 — GitHub access.** The wizard tells you exactly how to generate a fine-grained personal access token (PAT) and which repo to point at (it's the fork created in step 1).

   - **Step 3 — R2 image URL.** The wizard explains how to enable a public URL on the R2 bucket — either the quick `pub-xxx.r2.dev` URL or a custom subdomain. You only do this **after** the bucket exists, so you can actually copy the URL from the Cloudflare dashboard.

   - **Step 4 — Done.** You're dropped into `/admin` ready to add games.

Everything the wizard saves goes into your private R2 bucket (`_config/runtime.json`). Nothing sensitive is committed to GitHub.

## Local development

```bash
npm install
npm run watch:css   # in one terminal
npm run dev         # in another
```

Visit `http://localhost:8787/setup` and walk the wizard. You'll need a real GitHub PAT and (optionally) a real R2 public URL to fully exercise the admin.

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

Every page must contain at least one `seo-content` module for SEO purposes.

## Architecture

- **No framework**: plain TypeScript + tagged-template HTML on the server, Tailwind CSS for styles, vanilla JS for the setup wizard and admin SPA.
- **Runtime config in R2** (`_config/runtime.json`): admin password hash, signing secrets, GitHub token, R2 public URL. Env vars are honoured as a fallback for advanced users.
- **Content in Git**: pages, site config, i18n strings — all version-controlled.
- **Admin flow**: admin SPA → Worker `/admin/api` → GitHub Contents API → CF auto-deploys → JSON re-bundled into the next version.
- **Security**: PBKDF2-hashed admin password, HMAC-signed session cookies (HttpOnly, SameSite=Strict), CSRF header on all writes, signed upload tokens for R2, per-IP login rate limiting.

## License

MIT
