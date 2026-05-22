import type { Env } from '../types';
import { loadConfig } from '../lib/config';
import { readSession } from '../admin/auth';

// Render the setup wizard shell. The wizard is an SPA loaded from
// /assets/setup.js — this function just decides whether to allow access.
export async function renderSetupShell(env: Env, req: Request): Promise<Response> {
  const config = await loadConfig(env);
  // After setup is done, require admin session to re-enter.
  if (config.setupCompleted) {
    const session = await readSession(env, req);
    if (!session) {
      return new Response(null, { status: 303, headers: { Location: '/admin' } });
    }
  }
  return new Response(SHELL, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const SHELL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Setup · webgame-template</title>
  <link rel="stylesheet" href="/assets/app.css"/>
</head>
<body class="min-h-screen bg-slate-100">
  <div id="setup"></div>
  <script src="/assets/setup.js" defer></script>
</body>
</html>`;
