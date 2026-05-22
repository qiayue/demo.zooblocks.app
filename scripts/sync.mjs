#!/usr/bin/env node
// Pull the latest template code from upstream.
//
// Heavy lifting is done by git itself + the .gitattributes file at the
// repo root, which marks content/** as `merge=ours` so the merge keeps
// the local version of every user-data file automatically.
//
// This script just makes sure:
//   1. The upstream remote is configured.
//   2. The `merge.ours` driver is registered in the local repo.
//   3. `git pull upstream main` is invoked.
//
// If git reports conflicts (usually only wrangler.toml, if the user's
// name/bucket sit on a line that upstream also touched), the script
// stops and prints clear guidance.

import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:process';

const UPSTREAM_URL = 'https://github.com/qiayue/webgame.git';
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

  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (dirty) {
    fail('You have uncommitted changes:');
    log(dirty.split('\n').map((l) => `    ${l}`).join('\n'));
    log('');
    log('Commit or stash them first, then re-run this command.');
    process.exit(1);
  }

  // Register the "ours" merge driver locally. Idempotent — safe to re-run.
  git(['config', 'merge.ours.driver', 'true']);

  // Ensure upstream remote.
  const remotes = git(['remote']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!remotes.includes('upstream')) {
    const add = git(['remote', 'add', 'upstream', UPSTREAM_URL]);
    if (add.status !== 0) { fail('Failed to add upstream: ' + add.stderr); process.exit(1); }
    ok(`Added upstream → ${UPSTREAM_URL}`);
  } else {
    ok(`upstream → ${git(['remote', 'get-url', 'upstream']).stdout.trim()}`);
  }

  log('');
  log(`Pulling ${c.cyan}upstream/${UPSTREAM_BRANCH}${c.reset}…`);
  log('');

  try {
    await gitStream(['pull', '--no-rebase', '--no-edit', 'upstream', UPSTREAM_BRANCH]);
  } catch {
    log('');
    const conflicts = git(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
    if (conflicts) {
      fail('Merge conflicts:');
      log(conflicts.split('\n').map((l) => `    ${c.yellow}${l}${c.reset}`).join('\n'));
      log('');
      log(`${c.bold}How to resolve:${c.reset}`);
      log(`  - For ${c.cyan}wrangler.toml${c.reset}: keep your own ${c.bold}name${c.reset} and ${c.bold}bucket_name${c.reset};`);
      log(`    accept upstream for everything else. Open the file, find the`);
      log(`    "<<<<<<< / ======= / >>>>>>>" markers, and edit by hand.`);
      log(`  - When done: ${c.cyan}git add <file>${c.reset} then ${c.cyan}git commit${c.reset}.`);
      log(`  - To bail out and leave things untouched: ${c.cyan}git merge --abort${c.reset}.`);
    } else {
      fail('Pull failed. Check the error above (network? auth?).');
    }
    process.exit(1);
  }

  log('');
  ok('Sync complete.');
  log('');
  log(`${c.bold}Next steps:${c.reset}`);
  log(`  1. Run ${c.cyan}npm install${c.reset} (in case dependencies changed).`);
  log(`  2. Push: ${c.cyan}git push${c.reset}  (Cloudflare will redeploy automatically.)`);
  log('');
  log(`${c.dim}Your content/ directory wasn't touched — the .gitattributes`);
  log(`merge rule keeps the local version of every file under content/.${c.reset}`);
}

main().catch((err) => {
  log('');
  fail(err.message || String(err));
  process.exit(1);
});
