import type { Env } from '../types';
import {
  checkLoginRate,
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  recordLoginFailure,
  verifyPassword,
} from './auth';

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rate = checkLoginRate(req);
  if (!rate.ok) {
    return redirect('/admin?err=rate');
  }

  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const ok = await verifyPassword(env, password);
  if (!ok) {
    recordLoginFailure(req);
    return redirect('/admin?err=1');
  }
  clearLoginFailures(req);
  const secure = new URL(req.url).protocol === 'https:';
  const cookie = await createSessionCookie(env, { secure });
  return new Response(null, {
    status: 303,
    headers: { Location: '/admin', 'Set-Cookie': cookie },
  });
}

export async function handleLogout(req: Request, _env: Env): Promise<Response> {
  const secure = new URL(req.url).protocol === 'https:';
  return new Response(null, {
    status: 303,
    headers: { Location: '/admin', 'Set-Cookie': clearSessionCookie({ secure }) },
  });
}

function redirect(loc: string): Response {
  return new Response(null, { status: 303, headers: { Location: loc } });
}
