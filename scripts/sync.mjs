#!/usr/bin/env node
// Pull the latest template code from upstream while keeping your site's
// content and your Cloudflare binding names intact.
//
// What it does:
//   1. Adds the upstream remote if it isn't there.
//   2. Fetches upstream.
//   3. Shows you which files would change and asks for confirmation.
//   4. Overwrites the "template code" paths from upstream — but does NOT
//      touch your content/ directory.
//   5. For wrangler.toml: takes the upstream version but patches in YOUR
//      `name` and `bucket_name`, so you don't lose your Worker / bucket
//      configuration.
//   6. Re-installs npm dependencies in case package.json changed.
//   7. Tells you to review with `git diff HEAD` and commit / push.
//
// Files that are NEVER overwritten: content/ (your pages, tags, site
// config) and anything else not listed in SYNC_PATHS below.

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output, platform } from 'node:process';

const UPSTREAM_URL = 'https://github.com/qiayue/webgame.git';
const UPSTREAM_BRANCH = 'main';

// Paths to overwrite from upstream. Carefully curated to avoid wiping user
// data. Add to this list if upstream gains new template files.
const SYNC_PATHS = [
  'src',
  'public/assets/admin.js',
  'public/assets/setup.js',
  'public/assets/play.js',
  'scripts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tailwind.config.js',
  'README.md',
  'wrangler.toml', // handled specially — see patchWrangler() below
];

const isWindows = platform === 'win32';
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  brand: '\x1b[38;5;99m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const log = (s = '') => console.log(s);
const step = (n, total, m) => log(`\n${c.brand}${c.bold}[${n}/${total}]${c.reset} ${m}`);
const ok = (m) => log(`  ${c.green}✓${c.reset} ${m}`);
const warn = (m) => log(`  ${c.yellow}!${c.reset} ${m}`);
const fail = (m) => log(`  ${c.red}✗${c.reset} ${m}`);

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', shell: isWindows });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function gitStreaming(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { stdio: 'inherit', shell: isWindows });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} exited ${code}`))));
  });
}

async function ask(rl, q, def) {
  return new Promise((r) => rl.question(`${q}${def ? ` ${c.dim}(${def})${c.reset}` : ''} `, (a) => r((a || '').trim() || def || '')));
}

async function main() {
  log('');
  log(`${c.brand}${c.bold}webgame-template${c.reset} ${c.dim}— sync from upstream${c.reset}`);
  log('');
  log(`This pulls the latest template code from ${c.cyan}${UPSTREAM_URL}${c.reset}`);
  log(`while keeping your content/ and your Worker/bucket names intact.`);
  log('');

  // ----- 1. Inside a git repo? -----
  if (git(['rev-parse', '--git-dir']).status !== 0) {
    fail('Not inside a git repository. Run this from your site\'s root.');
    process.exit(1);
  }

  // ----- 2. Working tree clean? -----
  step(1, 5, 'Checking working tree');
  const status = git(['status', '--porcelain']).stdout.trim();
  if (status) {
    fail('You have uncommitted changes:');
    log(status.split('\n').map((l) => `    ${l}`).join('\n'));
    log('');
    log('Commit or stash them first, then re-run this command.');
    process.exit(1);
  }
  ok('Clean.');

  // ----- 3. Ensure upstream remote -----
  step(2, 5, 'Ensure upstream remote');
  const remotes = git(['remote']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!remotes.includes('upstream')) {
    const add = git(['remote', 'add', 'upstream', UPSTREAM_URL]);
    if (add.status !== 0) { fail('Failed to add remote: ' + add.stderr); process.exit(1); }
    ok(`Added upstream → ${UPSTREAM_URL}`);
  } else {
    const url = git(['remote', 'get-url', 'upstream']).stdout.trim();
    ok(`upstream → ${url}`);
  }

  // ----- 4. Fetch -----
  step(3, 5, 'Fetch upstream');
  try {
    await gitStreaming(['fetch', '--no-tags', 'upstream', UPSTREAM_BRANCH]);
  } catch {
    fail('Fetch failed. Check your network / SSH access to GitHub.');
    process.exit(1);
  }

  // ----- 5. Show what would change -----
  step(4, 5, 'See what would change');
  const summary = git(['diff', '--stat', `upstream/${UPSTREAM_BRANCH}`, 'HEAD', '--', ...SYNC_PATHS]).stdout;
  if (!summary.trim()) {
    ok('Nothing to sync — already up to date.');
    return;
  }
  log(summary.split('\n').map((l) => `  ${l}`).join('\n'));

  const rl = createInterface({ input, output });
  const answer = await ask(rl, `Apply these changes?`, 'y/N');
  rl.close();
  if (!/^y(es)?$/i.test(answer)) {
    log('Aborted. Nothing changed.');
    return;
  }

  // ----- 6. Save user's wrangler config before overwriting -----
  let localName, localBucket;
  try {
    const localToml = await readFile('wrangler.toml', 'utf8');
    localName = localToml.match(/^name\s*=\s*"([^"]*)"/m)?.[1];
    localBucket = localToml.match(/(?:\[\[r2_buckets\]\][^\[]*?)bucket_name\s*=\s*"([^"]*)"/s)?.[1];
  } catch {
    // No local wrangler.toml — odd but not fatal.
  }

  // ----- 7. Apply: checkout each path from upstream -----
  step(5, 5, 'Apply changes');
  for (const p of SYNC_PATHS) {
    const r = git(['checkout', `upstream/${UPSTREAM_BRANCH}`, '--', p]);
    if (r.status !== 0) {
      // If the path doesn't exist upstream we can ignore; otherwise it's an error.
      if (/did not match any file/i.test(r.stderr)) {
        warn(`upstream has no ${p} — skipped`);
      } else {
        fail(`checkout failed for ${p}: ${r.stderr.trim()}`);
        process.exit(1);
      }
    }
  }

  // ----- 8. Patch wrangler.toml: restore the user's name and bucket -----
  if (localName || localBucket) {
    try {
      let toml = await readFile('wrangler.toml', 'utf8');
      if (localName) {
        toml = toml.replace(/^name\s*=\s*"[^"]*"/m, `name = "${localName}"`);
      }
      if (localBucket) {
        toml = toml.replace(
          /(\[\[r2_buckets\]\][^\[]*?bucket_name\s*=\s*)"[^"]*"/s,
          `$1"${localBucket}"`,
        );
      }
      await writeFile('wrangler.toml', toml);
      ok(`wrangler.toml: restored name="${localName ?? '?'}", bucket="${localBucket ?? '?'}".`);
    } catch (e) {
      warn(`Couldn't patch wrangler.toml: ${e.message}. Check it manually.`);
    }
  }

  // Stage the updates so the user sees a clean diff against HEAD.
  git(['add', '--', ...SYNC_PATHS]);

  log('');
  ok('Template files updated and staged.');
  log('');
  log(`${c.bold}Next steps:${c.reset}`);
  log(`  1. Run ${c.cyan}npm install${c.reset} (in case dependencies changed).`);
  log(`  2. Review with ${c.cyan}git diff --staged${c.reset}.`);
  log(`  3. Commit: ${c.cyan}git commit -m "chore: sync template from upstream"${c.reset}`);
  log(`  4. Push: ${c.cyan}git push${c.reset}  (Cloudflare will redeploy automatically.)`);
  log('');
  log(`${c.dim}Your content/ directory was NOT touched.${c.reset}`);
}

main().catch((err) => {
  log('');
  fail(err.message || String(err));
  process.exit(1);
});
