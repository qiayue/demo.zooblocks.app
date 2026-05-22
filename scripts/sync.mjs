#!/usr/bin/env node
// Pull the latest template code from upstream — without using `git merge`.
//
// Why not `git merge`?  "Use this template" creates a new GitHub repo with
// no common history with the upstream template, so `git merge` refuses
// with "refusing to merge unrelated histories". Even with
// --allow-unrelated-histories the resulting merge generates avoidable
// conflicts on every file that drifted between the two trees.
//
// Instead, this script does a content-level sync:
//
//   1. Fetches upstream.
//   2. Diffs the local tree against `upstream/main` and lists every file
//      that differs.
//   3. For each file:
//      - Skip everything under content/* (user data).
//      - For wrangler.toml: take upstream's version, then patch in the
//        local `name`, `bucket_name`, and `account_id` (your deployment
//        configuration survives).
//      - Otherwise: replace local with upstream's version.
//   4. Stages all changes; the user reviews with `git diff --staged`
//      and commits.

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output, platform, env } from 'node:process';

const UPSTREAM_REPO = 'qiayue/webgame';
const UPSTREAM_BRANCH = 'main';
const isWindows = platform === 'win32';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  brand: '\x1b[38;5;99m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const log = (s = '') => console.log(s);
const ok = (m) => log(`  ${c.green}✓${c.reset} ${m}`);
const warn = (m) => log(`  ${c.yellow}!${c.reset} ${m}`);
const fail = (m) => log(`  ${c.red}✗${c.reset} ${m}`);

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', shell: isWindows });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function gitStream(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { stdio: 'inherit', shell: isWindows });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function main() {
  log('');
  log(`${c.brand}${c.bold}webgame-template${c.reset} ${c.dim}— sync from upstream${c.reset}`);
  log('');

  if (git(['rev-parse', '--git-dir']).status !== 0) {
    fail("Not inside a git repository. Run this from your site's root.");
    process.exit(1);
  }

  // Working tree must be clean — otherwise we can't safely overwrite files.
  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (dirty) {
    fail('You have uncommitted changes:');
    log(dirty.split('\n').map((l) => `    ${l}`).join('\n'));
    log('');
    log('Commit or stash them first, then re-run this command.');
    process.exit(1);
  }

  // Ensure upstream remote, with a URL that matches origin's protocol.
  const upstreamUrl = resolveUpstreamUrl();
  const remotes = git(['remote']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!remotes.includes('upstream')) {
    const add = git(['remote', 'add', 'upstream', upstreamUrl]);
    if (add.status !== 0) { fail('Failed to add upstream: ' + add.stderr); process.exit(1); }
    ok(`Added upstream → ${upstreamUrl}`);
  } else {
    const current = git(['remote', 'get-url', 'upstream']).stdout.trim();
    if (current !== upstreamUrl) {
      git(['remote', 'set-url', 'upstream', upstreamUrl]);
      ok(`upstream URL updated → ${upstreamUrl}`);
    } else {
      ok(`upstream → ${current}`);
    }
  }

  log('');
  log(`Fetching ${c.cyan}upstream/${UPSTREAM_BRANCH}${c.reset}…`);
  try {
    await gitStream(['fetch', '--no-tags', 'upstream', UPSTREAM_BRANCH]);
  } catch {
    log('');
    fail('Fetch failed. Check the error above.');
    log('');
    log(`If this is a network problem reaching GitHub over HTTPS (common in`);
    log(`some regions — symptoms include "HTTP2 framing layer" or timeouts):`);
    log(`  - Switch upstream to SSH: ${c.cyan}git remote set-url upstream git@github.com:${UPSTREAM_REPO}.git${c.reset}`);
    log(`  - Or force HTTP/1.1: ${c.cyan}git config --global http.version HTTP/1.1${c.reset}`);
    log(`  - Or use a proxy: ${c.cyan}git config --global http.https://github.com.proxy http://127.0.0.1:7890${c.reset}`);
    process.exit(1);
  }

  // Diff local against upstream. Each entry is "<status>\t<path>".
  const diffOutput = git(['diff', '--name-status', 'HEAD', `upstream/${UPSTREAM_BRANCH}`]).stdout.trim();
  if (!diffOutput) {
    log('');
    ok('Nothing to sync — already up to date.');
    return;
  }

  const toUpdate = [];     // files we'll overwrite from upstream
  const toRemove = [];     // files upstream deleted
  let wranglerNeedsMerge = false;

  for (const line of diffOutput.split('\n')) {
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    if (path.startsWith('content/')) continue;            // user data — never touch
    if (path === 'wrangler.toml') { wranglerNeedsMerge = true; continue; }
    if (status.startsWith('D')) toRemove.push(path);      // exists locally, gone in upstream
    else toUpdate.push(path);                              // A or M
  }

  if (!toUpdate.length && !toRemove.length && !wranglerNeedsMerge) {
    log('');
    ok('Nothing to sync — only content/ differs, and that\'s yours to keep.');
    return;
  }

  log('');
  log(`${c.bold}Changes from upstream:${c.reset}`);
  toUpdate.forEach((f) => log(`  ${c.green}+${c.reset} ${f}`));
  toRemove.forEach((f) => log(`  ${c.red}-${c.reset} ${f}`));
  if (wranglerNeedsMerge) log(`  ${c.brand}~${c.reset} wrangler.toml ${c.dim}(your name/bucket/account_id will be preserved)${c.reset}`);
  log('');

  const rl = createInterface({ input, output });
  const answer = await new Promise((r) =>
    rl.question(`  Apply? ${c.dim}(y/N)${c.reset} `, (a) => r((a || '').trim())),
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer)) {
    log('Aborted. Nothing changed.');
    return;
  }

  // Apply.
  for (const f of toUpdate) {
    const r = git(['checkout', `upstream/${UPSTREAM_BRANCH}`, '--', f]);
    if (r.status !== 0) {
      fail(`Failed to checkout ${f}: ${r.stderr.trim()}`);
      process.exit(1);
    }
  }
  for (const f of toRemove) {
    // Only remove files we're confident the user didn't add themselves. In
    // practice deletions in src/, public/assets/, scripts/, etc. are safe;
    // for anything outside known template paths we leave it as-is to avoid
    // accidentally wiping user files.
    if (looksLikeTemplatePath(f)) {
      git(['rm', '-q', '--', f]);
    } else {
      warn(`Upstream deleted ${f}, but it's outside known template paths — kept it. Delete by hand if you want.`);
    }
  }

  if (wranglerNeedsMerge) {
    await smartMergeWrangler();
  }

  // Stage everything so the user sees a clean diff against HEAD.
  git(['add', '-A']);

  log('');
  ok('Files updated and staged.');
  log('');
  log(`${c.bold}Next steps:${c.reset}`);
  log(`  1. Run ${c.cyan}npm install${c.reset} (in case dependencies changed).`);
  log(`  2. Review with ${c.cyan}git diff --staged${c.reset}.`);
  log(`  3. Commit: ${c.cyan}git commit -m "chore: sync template from upstream"${c.reset}`);
  log(`  4. Push: ${c.cyan}git push${c.reset}  (Cloudflare will redeploy automatically.)`);
  log('');
  log(`${c.dim}Your content/ directory wasn't touched.${c.reset}`);
}

function looksLikeTemplatePath(p) {
  return (
    p.startsWith('src/') ||
    p.startsWith('public/assets/') ||
    p.startsWith('scripts/') ||
    p === '.gitattributes' ||
    p === 'tsconfig.json' ||
    p === 'tailwind.config.js' ||
    p === 'package-lock.json'
  );
}

async function smartMergeWrangler() {
  const tomlPath = 'wrangler.toml';
  let localToml;
  try {
    localToml = await readFile(tomlPath, 'utf8');
  } catch {
    // No local wrangler.toml — just take upstream's wholesale.
    git(['checkout', `upstream/${UPSTREAM_BRANCH}`, '--', tomlPath]);
    return;
  }

  const name = matchOne(localToml, /^name\s*=\s*"([^"]*)"/m);
  const bucket = matchOne(localToml, /(?:\[\[r2_buckets\]\][^\[]*?)bucket_name\s*=\s*"([^"]*)"/s);
  const accountId = matchOne(localToml, /^account_id\s*=\s*"([^"]*)"/m);

  const r = git(['checkout', `upstream/${UPSTREAM_BRANCH}`, '--', tomlPath]);
  if (r.status !== 0) { fail('Failed to checkout wrangler.toml from upstream.'); process.exit(1); }

  let next = await readFile(tomlPath, 'utf8');
  if (name) next = next.replace(/^name\s*=\s*"[^"]*"/m, `name = "${name}"`);
  if (bucket) {
    next = next.replace(
      /(\[\[r2_buckets\]\][^\[]*?bucket_name\s*=\s*)"[^"]*"/s,
      `$1"${bucket}"`,
    );
  }
  if (accountId) {
    if (/^account_id\s*=/m.test(next)) {
      next = next.replace(/^account_id\s*=\s*"[^"]*"/m, `account_id = "${accountId}"`);
    } else {
      // Anchor on the `main = "..."` line for a stable position.
      const inserted = next.replace(
        /^(main\s*=\s*"[^"]*"\n)/m,
        `$1account_id = "${accountId}"\n`,
      );
      next = inserted !== next ? inserted : `account_id = "${accountId}"\n${next}`;
    }
  }
  await writeFile(tomlPath, next);
  ok(`wrangler.toml: kept name="${name ?? '?'}", bucket="${bucket ?? '?'}", account_id="${accountId ?? '(none)'}"`);
}

function matchOne(text, re) {
  const m = text.match(re);
  return m ? m[1] : undefined;
}

function resolveUpstreamUrl() {
  if (env.WEBGAME_UPSTREAM_URL) return env.WEBGAME_UPSTREAM_URL;
  const origin = git(['remote', 'get-url', 'origin']).stdout.trim();
  if (/^git@/.test(origin) || /^ssh:\/\//.test(origin)) {
    return `git@github.com:${UPSTREAM_REPO}.git`;
  }
  return `https://github.com/${UPSTREAM_REPO}.git`;
}

main().catch((err) => {
  log('');
  fail(err.message || String(err));
  process.exit(1);
});
