import type { RuntimeConfig } from './config';

const API = 'https://api.github.com';

interface GhRequestInit {
  method?: string;
  body?: unknown;
}

export interface GhClient {
  repo: string;
  branch: string;
  token: string;
}

export function ghClient(config: RuntimeConfig): GhClient {
  return { repo: config.github.repo, branch: config.github.branch, token: config.github.token };
}

async function gh<T>(c: GhClient, path: string, init: GhRequestInit = {}): Promise<T> {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${c.token}`,
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
  c: GhClient,
  filePath: string,
): Promise<{ sha: string; text: string } | null> {
  const ref = encodeURIComponent(c.branch);
  try {
    const data = await gh<GhContent>(
      c,
      `/repos/${c.repo}/contents/${encodeURI(filePath)}?ref=${ref}`,
    );
    if (data.encoding === 'base64' && data.content) {
      const bin = atob(data.content.replace(/\n/g, ''));
      return { sha: data.sha, text: utf8Decode(bin) };
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

export async function putFile(c: GhClient, input: PutFileInput): Promise<void> {
  let sha = input.sha;
  if (!sha) {
    const existing = await getFile(c, input.path);
    if (existing) sha = existing.sha;
  }
  const content = utf8Base64(input.text);
  await gh(c, `/repos/${c.repo}/contents/${encodeURI(input.path)}`, {
    method: 'PUT',
    body: {
      message: input.message,
      content,
      branch: c.branch,
      ...(sha ? { sha } : {}),
    },
  });
}

export interface CommitFile {
  path: string;
  text: string;
}

export async function commitFiles(
  c: GhClient,
  files: CommitFile[],
  message: string,
): Promise<void> {
  if (files.length === 0) return;
  const branch = c.branch;
  const repo = c.repo;

  const refData = await gh<{ object: { sha: string } }>(
    c,
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const latestCommitSha = refData.object.sha;

  const commitData = await gh<{ tree: { sha: string } }>(
    c,
    `/repos/${repo}/git/commits/${latestCommitSha}`,
  );
  const baseTreeSha = commitData.tree.sha;

  const blobs = await Promise.all(
    files.map((f) =>
      gh<{ sha: string }>(c, `/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: { content: utf8Base64(f.text), encoding: 'base64' },
      }),
    ),
  );

  const treeData = await gh<{ sha: string }>(c, `/repos/${repo}/git/trees`, {
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

  const newCommit = await gh<{ sha: string }>(c, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: treeData.sha, parents: [latestCommitSha] },
  });

  await gh(c, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: newCommit.sha, force: false },
  });
}

export async function deleteFile(c: GhClient, filePath: string): Promise<void> {
  const existing = await getFile(c, filePath);
  if (!existing) return;
  await gh(c, `/repos/${c.repo}/contents/${encodeURI(filePath)}`, {
    method: 'DELETE',
    body: {
      message: `chore(content): remove file ${filePath}`,
      sha: existing.sha,
      branch: c.branch,
    },
  });
}

// ---------------------------------------------------------------------------
// Connection test (used by the setup wizard).
// ---------------------------------------------------------------------------

export async function testConnection(c: GhClient): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!c.token) return { ok: false, error: 'token is empty' };
  if (!c.repo || !c.repo.includes('/')) return { ok: false, error: 'repo must be "owner/name"' };
  try {
    await gh<{ name: string }>(c, `/repos/${c.repo}`);
    // Also verify branch exists.
    await gh(c, `/repos/${c.repo}/git/ref/heads/${encodeURIComponent(c.branch)}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
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
