#!/usr/bin/env node
// One-step deployment helper. Runs after the user has cloned their fork.
//
// What it does, in order:
//   1. Asks the user for a Worker name and an R2 bucket name.
//   2. Updates wrangler.toml in place.
//   3. Ensures `wrangler login` has been run (opens a browser once).
//   4. Creates the R2 bucket (ignores "already exists").
//   5. Builds the Tailwind CSS bundle.
//   6. Runs `wrangler deploy`.
//   7. Prints the deployed URL and tells the user where to go next.
//
// Aborts cleanly on Ctrl-C. Safe to re-run.

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output, platform } from 'node:process';

const isWindows = platform === 'win32';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  brand: '\x1b[38;5;99m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const log = (s = '') => console.log(s);
const step = (n, total, msg) => log(`\n${c.brand}${c.bold}[${n}/${total}]${c.reset} ${msg}`);
const ok = (msg) => log(`  ${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => log(`  ${c.yellow}!${c.reset} ${msg}`);
const fail = (msg) => log(`  ${c.red}✗${c.reset} ${msg}`);

async function main() {
  log('');
  log(`${c.brand}${c.bold}webgame-template${c.reset} ${c.dim}— one-step deploy${c.reset}`);
  log('');
  log(`This will deploy this site to your own Cloudflare account. About 3 minutes.`);
  log(`You'll need a Cloudflare account (free tier is fine). The script will open a browser`);
  log(`for the Cloudflare login. Nothing leaves your machine except the deploy itself.`);
  log('');

  const rl = createInterface({ input, output });
  const ask = (q, def) =>
    new Promise((r) => rl.question(`${q}${def ? ` ${c.dim}(${def})${c.reset}` : ''} `, (a) => r((a || '').trim() || def || '')));

  // ----- Step 1: collect names -----
  step(1, 6, 'Pick a name for your site');
  const workerName = await ask(`  Worker name:`, 'webgame');
  const bucketName = await ask(`  R2 bucket name:`, `${workerName}-uploads`);
  rl.close();

  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName)) {
    fail(`Worker name must be lowercase letters, digits, dashes; max 63 chars.`);
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucketName)) {
    fail(`Bucket name must be lowercase letters, digits, dashes; 2–63 chars.`);
    process.exit(1);
  }

  // ----- Step 2: rewrite wrangler.toml -----
  step(2, 6, 'Update wrangler.toml');
  const tomlPath = new URL('../wrangler.toml', import.meta.url);
  let toml;
  try {
    toml = await readFile(tomlPath, 'utf8');
  } catch {
    fail('wrangler.toml not found. Run this script from the project root.');
    process.exit(1);
  }
  const nextToml = toml
    .replace(/^name\s*=\s*".*"/m, `name = "${workerName}"`)
    .replace(/(\[\[r2_buckets\]\][^\[]*?bucket_name\s*=\s*)"[^"]*"/s, `$1"${bucketName}"`);
  if (nextToml === toml) warn('wrangler.toml unchanged (already up to date).');
  else {
    await writeFile(tomlPath, nextToml);
    ok(`wrangler.toml: name="${workerName}", bucket="${bucketName}".`);
  }

  // ----- Step 3: wrangler login -----
  step(3, 6, 'Sign in to Cloudflare');
  const whoami = spawnSync('npx', ['wrangler', 'whoami'], { encoding: 'utf8', shell: isWindows });
  if (whoami.status === 0 && /You are logged in/i.test(whoami.stdout || '')) {
    ok('Already signed in.');
  } else {
    log(`  Opening browser for Cloudflare sign-in…`);
    await runStreaming('npx', ['wrangler', 'login']);
    ok('Signed in.');
  }

  // ----- Step 4: create R2 bucket -----
  step(4, 6, `Create R2 bucket "${bucketName}"`);
  const create = spawnSync('npx', ['wrangler', 'r2', 'bucket', 'create', bucketName], {
    encoding: 'utf8',
    shell: isWindows,
  });
  const combined = `${create.stdout || ''}${create.stderr || ''}`;
  if (create.status === 0) ok('Bucket created.');
  else if (/already exists/i.test(combined)) ok('Bucket already exists — reusing.');
  else {
    fail('Bucket create failed:');
    log(combined.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    process.exit(1);
  }

  // ----- Step 5: build CSS -----
  step(5, 6, 'Build CSS');
  await runStreaming('npm', ['run', 'build:css']);
  ok('CSS built.');

  // ----- Step 6: deploy -----
  step(6, 6, 'Deploy the Worker');
  await runStreaming('npx', ['wrangler', 'deploy']);

  log('');
  log(`${c.green}${c.bold}✓ Deployed!${c.reset}`);
  log('');
  log(`Your Worker is live at:`);
  log(`  ${c.cyan}https://${workerName}.<your-cf-subdomain>.workers.dev${c.reset}`);
  log(`(The exact URL appears just above this message.)`);
  log('');
  log(`${c.bold}What to do next:${c.reset}`);
  log(`  1. Open the URL above. You'll be redirected to ${c.cyan}/setup${c.reset}.`);
  log(`  2. Walk through the wizard: admin password → GitHub token → R2 public URL.`);
  log(`  3. After the wizard you land at ${c.cyan}/admin${c.reset} and can add games.`);
  log('');
  log(`${c.dim}Tip: if you change wrangler.toml later, run \`npm run deploy\` to redeploy.${c.reset}`);
}

function runStreaming(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: isWindows });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

main().catch((err) => {
  log('');
  fail(err.message || String(err));
  process.exit(1);
});
