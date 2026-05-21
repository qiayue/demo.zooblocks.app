import type { Env } from '../types';
import { readSession } from './auth';

// ---------------------------------------------------------------------------
// Admin UI shell.
//
// The admin UI is a single-page application that renders entirely on the
// client. We ship one HTML shell + one JS bundle (admin.js, served as a
// static asset). The shell is intentionally minimal — when you load /admin
// while not authenticated, you get the login form; otherwise you get the
// SPA shell.
// ---------------------------------------------------------------------------

export async function renderAdminShell(env: Env, req: Request): Promise<Response> {
  const session = await readSession(env, req);
  if (!session) return renderLoginPage();
  return new Response(renderAppShell(), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function renderLoginPage(): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Admin Login</title>
  <link rel="stylesheet" href="/assets/app.css"/>
</head>
<body class="min-h-screen bg-slate-100 flex items-center justify-center p-4">
  <form method="POST" action="/admin/login" class="card w-full max-w-sm p-6 space-y-4">
    <div>
      <div class="text-lg font-semibold text-slate-900">Admin Login</div>
      <p class="text-sm text-slate-500 mt-1">Enter your admin password to continue.</p>
    </div>
    <input type="password" name="password" required autocomplete="current-password"
      class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
      placeholder="Password"/>
    <button type="submit" class="btn-primary w-full">Sign in</button>
    <div id="err" class="text-sm text-rose-600 hidden"></div>
  </form>
  <script>
    const params = new URLSearchParams(location.search);
    if (params.get('err')) {
      const el = document.getElementById('err');
      el.textContent = params.get('err') === 'rate' ? 'Too many attempts. Try again later.' : 'Invalid password.';
      el.classList.remove('hidden');
    }
  </script>
</body>
</html>`;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function renderAppShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Admin · webgame-template</title>
  <link rel="stylesheet" href="/assets/app.css"/>
</head>
<body class="min-h-screen bg-slate-100">
  <div id="app" class="min-h-screen"></div>
  <script src="/assets/admin.js" defer></script>
</body>
</html>`;
}
