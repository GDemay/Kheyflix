// Git operations for the controller. Push credentials travel only through a
// per-invocation environment variable consumed by an inline credential
// helper — they never appear in argv, URLs, or logs.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { redactString } from './redact.js';

export function git(args, { cwd, env = {}, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.message = redactString(`git ${args.join(' ')} failed: ${err.message} ${stderr}`);
          reject(err);
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

export async function ensureIdentity(repoPath, { name, email }) {
  await git(['config', 'user.name', name], { cwd: repoPath });
  await git(['config', 'user.email', email], { cwd: repoPath });
}

export async function defaultBranch(repoPath) {
  try {
    const out = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoPath });
    return out.trim().replace(/^origin\//, '');
  } catch {
    return 'main';
  }
}

export async function headSha(cwd) {
  return (await git(['rev-parse', 'HEAD'], { cwd })).trim();
}

export async function commitCount(cwd, baseRef) {
  const out = await git(['rev-list', '--count', `${baseRef}..HEAD`], { cwd });
  return Number(out.trim());
}

export async function hasLocalBranch(repoPath, branch) {
  try {
    await git(['rev-parse', '--verify', `refs/heads/${branch}`], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create (or reuse) a detached worktree on `branch`. When the branch exists it
 * is checked out as-is (restart recovery); otherwise it is created from
 * `baseRef`.
 */
export async function createWorktree({ repoPath, dir, branch, baseRef }) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(['worktree', 'prune'], { cwd: repoPath }).catch(() => {});
  if (await hasLocalBranch(repoPath, branch)) {
    const existing = await git(['worktree', 'list', '--porcelain'], { cwd: repoPath });
    if (!existing.includes(branch)) {
      await git(['worktree', 'add', dir, branch], { cwd: repoPath });
    }
    return { dir, created: false };
  }
  await git(['worktree', 'add', '-b', branch, dir, baseRef], { cwd: repoPath });
  return { dir, created: true };
}

export async function removeWorktree({ repoPath, dir }) {
  try {
    await git(['worktree', 'remove', '--force', dir], { cwd: repoPath });
  } catch {
    /* already gone */
  }
}

function pushEnv(tokenEnvName) {
  const helper =
    "!f() { echo \"username=x-access-token\"; echo \"password=${\" + tokenEnvName + \"}\"; }; f";
  return {
    env: { [tokenEnvName]: process.env[tokenEnvName] ?? '' },
    helper,
  };
}

/** Push a branch using an inline credential helper fed from the environment. */
export async function pushBranch({ repoPath, branch, remoteUrl, tokenEnvName }) {
  const { env, helper } = pushEnv(tokenEnvName);
  await git(
    [
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=${helper}`,
      'push',
      remoteUrl,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ],
    { cwd: repoPath, env },
  );
}

/**
 * Revert a merge commit on main via a temporary main worktree, then push.
 * Used only for post-merge regression containment.
 */
export async function revertOnMain({ repoPath, mergeSha, remoteUrl, tokenEnvName, message, tmpDir }) {
  const dir = path.join(tmpDir, 'main-ops');
  await git(['fetch', 'origin', 'main'], { cwd: repoPath }).catch(() => {});
  await git(['worktree', 'add', '--detach', dir, 'origin/main'], { cwd: repoPath });
  try {
    await git(['revert', '--no-edit', mergeSha], { cwd: dir });
    if (message) {
      await git(['commit', '--amend', '-m', message], { cwd: dir });
    }
    const { env, helper } = pushEnv(tokenEnvName);
    await git(
      ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'push', remoteUrl, 'HEAD:refs/heads/main'],
      { cwd: dir, env },
    );
    return (await headSha(dir)).trim();
  } finally {
    await removeWorktree({ repoPath, dir });
  }
}
