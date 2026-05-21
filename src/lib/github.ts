import type { Env } from '../types';

const API = 'https://api.github.com';

interface GhRequestInit {
  method?: string;
  body?: unknown;
}

async function gh<T>(env: Env, path: string, init: GhRequestInit = {}): Promise<T> {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'webgame-template/1.0',
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GitHubError(res.status, `GitHub ${init.method ?? 'GET'} ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface GhContent {
  sha: string;
  content?: string;
  encoding?: string;
}

export async function getFile(
  env: Env,
  filePath: string,
): Promise<{ sha: string; text: string } | null> {
  const ref = encodeURIComponent(env.GITHUB_BRANCH);
  try {
    const data = await gh<GhContent>(
      env,
      `/repos/${env.GITHUB_REPO}/contents/${encodeURI(filePath)}?ref=${ref}`,
    );
    if (data.encoding === 'base64' && data.content) {
      const text = atob(data.content.replace(/\n/g, ''));
      return { sha: data.sha, text: utf8Decode(text) };
    }
    return { sha: data.sha, text: '' };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export interface PutFileInput {
  path: string;
  message: string;
  text: string;
  sha?: string;
}

export async function putFile(env: Env, input: PutFileInput): Promise<void> {
  // Look up existing sha if not provided.
  let sha = input.sha;
  if (!sha) {
    const existing = await getFile(env, input.path);
    if (existing) sha = existing.sha;
  }
  const content = utf8Base64(input.text);
  await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodeURI(input.path)}`, {
    method: 'PUT',
    body: {
      message: input.message,
      content,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    },
  });
}

export interface CommitFile {
  path: string;
  text: string;
}

/**
 * Commit multiple files in a single commit via the Git Data API.
 * Used when one logical "save" touches both the page detail JSON and the
 * index JSON.
 */
export async function commitFiles(
  env: Env,
  files: CommitFile[],
  message: string,
): Promise<void> {
  if (files.length === 0) return;
  const branch = env.GITHUB_BRANCH;
  const repo = env.GITHUB_REPO;

  // 1) Get the latest commit on the branch
  const refData = await gh<{ object: { sha: string } }>(
    env,
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const latestCommitSha = refData.object.sha;

  // 2) Get the tree for that commit
  const commitData = await gh<{ tree: { sha: string } }>(
    env,
    `/repos/${repo}/git/commits/${latestCommitSha}`,
  );
  const baseTreeSha = commitData.tree.sha;

  // 3) Create blobs
  const blobs = await Promise.all(
    files.map((f) =>
      gh<{ sha: string }>(env, `/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: { content: utf8Base64(f.text), encoding: 'base64' },
      }),
    ),
  );

  // 4) Create a new tree
  const treeData = await gh<{ sha: string }>(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: baseTreeSha,
      tree: files.map((f, i) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        sha: blobs[i]!.sha,
      })),
    },
  });

  // 5) Create a new commit
  const newCommit = await gh<{ sha: string }>(env, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: treeData.sha,
      parents: [latestCommitSha],
    },
  });

  // 6) Move the branch
  await gh(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: newCommit.sha, force: false },
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function utf8Decode(bin: string): string {
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
