import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Admin authentication.
//
// Single-user, password-only. The password is stored as a Worker secret
// (ADMIN_PASSWORD). On successful login we issue an HMAC-signed cookie that
// includes an expiration; subsequent admin requests must present a valid,
// non-expired cookie. CSRF for state-changing requests is handled separately
// in `api.ts`.
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'wg_admin';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export interface Session {
  user: 'admin';
  exp: number; // unix seconds
}

export async function createSessionCookie(
  env: Env,
  opts: { secure?: boolean } = {},
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const session: Session = { user: 'admin', exp: now + SESSION_TTL_SEC };
  const payload = btoa(JSON.stringify(session));
  const sig = await hmac(env.ADMIN_SESSION_SECRET, payload);
  const value = `${payload}.${sig}`;
  const secure = opts.secure !== false; // default secure
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookie(opts: { secure?: boolean } = {}): string {
  const secure = opts.secure !== false;
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=0`;
}

export async function readSession(env: Env, req: Request): Promise<Session | null> {
  const cookieHeader = req.headers.get('Cookie');
  if (!cookieHeader) return null;
  const cookie = parseCookie(cookieHeader)[COOKIE_NAME];
  if (!cookie) return null;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return null;
  const expected = await hmac(env.ADMIN_SESSION_SECRET, payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(atob(payload)) as Session;
    if (typeof data.exp !== 'number') return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function verifyPassword(env: Env, input: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  if (input.length === 0) return false;
  // Constant-time-ish compare: hash both, compare HMACs.
  const a = await hmac(env.ADMIN_SESSION_SECRET, input);
  const b = await hmac(env.ADMIN_SESSION_SECRET, env.ADMIN_PASSWORD);
  return safeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Rate limiting (per-instance, in-memory). Best-effort: at scale this won't
// fully prevent distributed brute-force, but blocks single-IP grinding.
// ---------------------------------------------------------------------------

interface RateEntry {
  count: number;          // failures within the current window
  windowStart: number;    // when the failure window began
  lockedUntil: number;    // unix ms; non-zero while locked
}

const loginAttempts = new Map<string, RateEntry>();
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function checkLoginRate(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.lockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { ok: true };
}

export function recordLoginFailure(req: Request) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.count = 0;
    entry.windowStart = now;
  }
  loginAttempts.set(ip, entry);
}

export function clearLoginFailures(req: Request) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  loginAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// crypto helpers
// ---------------------------------------------------------------------------

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upload signing (R2)
// ---------------------------------------------------------------------------

export async function signUploadToken(
  env: Env,
  filename: string,
  contentType: string,
  expiresAt: number,
): Promise<string> {
  const payload = btoa(JSON.stringify({ filename, contentType, exp: expiresAt }));
  const sig = await hmac(env.R2_UPLOAD_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function verifyUploadToken(
  env: Env,
  token: string,
): Promise<{ filename: string; contentType: string } | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = await hmac(env.R2_UPLOAD_SECRET, payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(atob(payload)) as { filename: string; contentType: string; exp: number };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { filename: data.filename, contentType: data.contentType };
  } catch {
    return null;
  }
}
