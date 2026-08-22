// Central configuration. Everything is env-overridable for tests; production
// defaults match the external launchd install described in docs/launchd.md.

import path from 'node:path';
import os from 'node:os';

export const REQUIRED_PROVIDER = 'openrouter-ox';
export const REQUIRED_MODEL = 'stealth/ox-alpha';
export const RESOLVED_MODEL = `${REQUIRED_PROVIDER}/${REQUIRED_MODEL}`;

export const ACTIVE_STATES = [
  'claimed',
  'ox_running',
  'pushing',
  'pr_open',
  'ci_pending',
  'ci_failed',
  'repairing',
  'review_pending',
  'review_changes',
  'merging',
  'post_merge_pending',
  'post_merge_failed',
  'hotfixing',
];

export const TERMINAL_STATES = ['completed', 'failed', 'reverted'];

export const DEFAULTS = {
  readyLabel: 'agent:ready',
  holdLabel: 'agent:hold',
  priorityLabelRe: /^agent:priority:(\d+)$/,
  defaultPriority: 5,
  branchPrefix: 'agent/issue-',
  harnessProfile: 'kheyflix-ox',
  harnessTimeoutMs: 45 * 60_000,
  harnessMaxAttempts: 2,
  repairMaxAttempts: 3,
  modelOutageMaxAttempts: 5,
  modelOutageBackoffMs: 5 * 60_000,
  ciTimeoutMs: 30 * 60_000,
  ciPollMs: 15_000,
  reviewTimeoutMs: 24 * 60 * 60_000,
  lockStaleMs: 10 * 60_000,
  heartbeatStaleMs: 15 * 60_000,
  mergeMethod: 'squash',
  baseBranch: 'main',
  controllerGitName: 'Ox Alpha (control plane)',
  controllerGitEmail: 'ox-alpha@kheyflix.local',
  pushTokenEnv: 'KHEYFLIX_GITHUB_TOKEN',
  trustedLogins: [],
  logTailBytes: 16_000,
};

export function loadConfig(env = process.env) {
  const repoPath = env.KHEYFLIX_REPO_PATH || process.cwd();
  const stateDir = env.KHEYFLIX_STATE_DIR || path.join(repoPath, '.kheyflix');
  const repoSlug = env.KHEYFLIX_REPO || 'GDemay/Kheyflix';
  const [owner, repo] = repoSlug.split('/');
  const num = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  const cfg = {
    repoPath,
    stateDir,
    dbPath: env.KHEYFLIX_DB || path.join(stateDir, 'state.db'),
    logDir: path.join(stateDir, 'logs'),
    worktreeDir: path.join(stateDir, 'worktrees'),
    owner,
    repo,
    repoSlug,
    githubToken: env.KHEYFLIX_GITHUB_TOKEN || env.GITHUB_TOKEN || '',
    githubApiBase: env.KHEYFLIX_GITHUB_API || 'https://api.github.com',
    pushRemoteUrl: env.KHEYFLIX_PUSH_URL || `https://github.com/${repoSlug}.git`,
    dshHome: env.DSH_HOME || '/dsh',
    harnessCmd: env.KHEYFLIX_HARNESS_CMD || 'dsh',
    ...DEFAULTS,
  };
  if (env.KHEYFLIX_TRUSTED_LOGINS) {
    cfg.trustedLogins = env.KHEYFLIX_TRUSTED_LOGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  cfg.ciTimeoutMs = num(env.KHEYFLIX_CI_TIMEOUT_MS, cfg.ciTimeoutMs);
  cfg.harnessTimeoutMs = num(env.KHEYFLIX_HARNESS_TIMEOUT_MS, cfg.harnessTimeoutMs);
  cfg.lockStaleMs = num(env.KHEYFLIX_LOCK_STALE_MS, cfg.lockStaleMs);
  cfg.heartbeatStaleMs = num(env.KHEYFLIX_HEARTBEAT_STALE_MS, cfg.heartbeatStaleMs);
  return cfg;
}

export function controllerEnv(cfg) {
  return {
    GIT_AUTHOR_NAME: cfg.controllerGitName,
    GIT_AUTHOR_EMAIL: cfg.controllerGitEmail,
    GIT_COMMITTER_NAME: cfg.controllerGitName,
    GIT_COMMITTER_EMAIL: cfg.controllerGitEmail,
  };
}

export function hostTag() {
  return `${os.hostname()}/${process.pid}`;
}
