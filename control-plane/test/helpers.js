// Hermetic test fixtures: local bare "origin", a wired clone, an in-memory
// GitHub double, and a stub Harness CLI. No network, no real Harness.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function g(args, { cwd, input, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        input,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@kheyflix.local',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@kheyflix.local',
          ...env,
        },
        maxBuffer: 1 << 26,
      },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))),
    );
  });
}

export async function tmpDir(prefix = 'kheyflix-test-') {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** bare origin + seed commit + configured clone */
export async function makeRepoFixture() {
  const base = await tmpDir();
  const seed = path.join(base, 'seed');
  const origin = path.join(base, 'origin.git');
  const repoPath = path.join(base, 'repo');
  await g(['init', '-b', 'main', seed]);
  await fs.promises.writeFile(path.join(seed, 'README.md'), '# seed\n');
  await g(['add', '.'], { cwd: seed });
  await g(['commit', '-m', 'seed'], { cwd: seed });
  await g(['init', '--bare', '-b', 'main', origin]);
  await g(['remote', 'add', 'origin', origin], { cwd: seed });
  await g(['push', 'origin', 'refs/heads/main:refs/heads/main'], { cwd: seed });
  await g(['clone', origin, repoPath]);
  await g(['config', 'user.name', 'Test Controller'], { cwd: repoPath });
  await g(['config', 'user.email', 'test@kheyflix.local'], { cwd: repoPath });
  return { base, originUrl: origin, repoPath };
}

/**
 * Real-but-distinct merge commits on the bare main branch, so post-merge
 * revert containment operates on genuine git history.
 */
export function makeMergeShaFactory(repoPath) {
  const salt = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let n = 0;
  return async () => {
    n += 1;
    const indexFile = path.join(repoPath, `.merge-index-${salt}-${n}`);
    const run = (args, opts = {}) => g(args, { cwd: repoPath, ...opts });
    try {
      await run(['read-tree', 'origin/main'], { env: { GIT_INDEX_FILE: indexFile } });
      // Unique marker per merge so every synthetic merge is a non-empty diff
      // (revert containment must always have something to invert).
      const marker = `merge-marker-${salt}-${n}.txt`;
      const blobPath = path.join(os.tmpdir(), `merge-payload-${salt}-${n}`);
      fs.writeFileSync(blobPath, `merge payload ${n}\n`);
      const blob = (await run(['hash-object', '-w', blobPath])).trim();
      await run(['update-index', '--add', '--cacheinfo', `100644,${blob},${marker}`], {
        env: { GIT_INDEX_FILE: indexFile },
      });
      const tree = (await run(['write-tree'], { env: { GIT_INDEX_FILE: indexFile } })).trim();
      // -F file instead of stdin piping: child_process input handling has
      // proven flaky under this sandbox (zombie children, no close event).
      const msgPath = path.join(os.tmpdir(), `merge-msg-${salt}-${n}`);
      fs.writeFileSync(msgPath, `synthetic merge ${n}\n`);
      const sha = (await run(['commit-tree', tree, '-p', 'origin/main', '-F', msgPath])).trim();
      await run(['push', 'origin', `${sha}:refs/heads/main`]);
      fs.rmSync(blobPath, { force: true });
      fs.rmSync(msgPath, { force: true });
      return sha;
    } finally {
      fs.rmSync(indexFile, { force: true });
    }
  };
}

/** In-memory GitHub double covering the client surface the controller uses. */
export class FakeGitHub {
  constructor({ owner = 'test', repo = 'kheyflix' } = {}) {
    this.owner = owner;
    this.repo = repo;
    this.issues = [];
    this.prs = [];
    this.branches = new Set();
    this.ci = new Map();
    this.reviews = new Map();
    this.comments = [];
    this.mergeShaFactory = null;
    this.calls = { createPR: 0, closePR: 0, mergePR: 0 };
    this.nextPrNumber = 100;
  }

  addIssue(i) {
    this.issues.push({
      labels: [],
      state: 'open',
      created_at: '2026-01-01T00:00:00Z',
      user: { login: 'manager' },
      body: '',
      title: 'untitled',
      ...i,
    });
  }

  addPR(p) {
    const number = p.number ?? this.nextPrNumber++;
    const { head, fork, ...rest } = p;
    const pr = {
      title: rest.title ?? `issue #${rest.issueNumber ?? 0}`,
      head: typeof head === 'string' ? { ref: head, sha: `sha-${head}` } : head,
      base: 'main',
      state: 'open',
      merged: false,
      html_url: `https://example.test/pr/${number}`,
      fork: false,
      ...rest,
      fork: fork ?? false,
      number,
    };
    this.prs.push(pr);
    if (p.head) this.branches.add(p.head);
    return pr;
  }

  setCi(ref, value) {
    this.ci.set(ref, value);
  }

  approve(prNumber, user = 'manager', body = 'looks good') {
    this.#review(prNumber, { state: 'APPROVED', user, body });
  }

  requestChanges(prNumber, body, user = 'manager') {
    this.#review(prNumber, { state: 'CHANGES_REQUESTED', user, body });
  }

  #review(prNumber, r) {
    const list = this.reviews.get(prNumber) ?? [];
    list.push({ state: r.state, user: { login: r.user }, body: r.body ?? '', submitted_at: new Date().toISOString() });
    this.reviews.set(prNumber, list);
  }

  async listIssues({ state = 'open' } = {}) {
    return this.issues.filter((i) => state === 'all' || i.state === state);
  }

  async listClosedIssueNumbers() {
    return this.issues.filter((i) => i.state === 'closed').map((i) => i.number);
  }

  async getIssue(n) {
    return this.issues.find((i) => i.number === n) ?? null;
  }

  async listBranches({ prefix = '' } = {}) {
    return [...this.branches].filter((b) => b.startsWith(prefix));
  }

  async listOpenPRs() {
    return this.prs.filter((p) => p.state === 'open');
  }

  isForkPR(pr) {
    return Boolean(pr.fork);
  }

  async getPRForHead(branch) {
    return this.prs.find((p) => p.head?.ref === branch && p.state === 'open') ?? null;
  }

  async createPR({ title, head, base, body }) {
    this.calls.createPR += 1;
    return this.addPR({ title, head, base, body });
  }

  async getPR(n) {
    const pr = this.prs.find((p) => p.number === n);
    if (!pr) throw Object.assign(new Error('not found'), { status: 404 });
    return { ...pr };
  }

  async closePR(n, comment) {
    this.calls.closePR += 1;
    if (comment) this.comments.push({ pr: n, body: comment });
    const pr = this.prs.find((p) => p.number === n);
    if (pr) pr.state = 'closed';
    return pr ? { ...pr } : null;
  }

  async commentOn(n, body) {
    this.comments.push({ pr: n, body });
  }

  async listReviews(n) {
    return this.reviews.get(n) ?? [];
  }

  async reviewDecision(n) {
    const latestByUser = new Map();
    for (const r of this.reviews.get(n) ?? []) latestByUser.set(r.user.login, r);
    const decisions = [...latestByUser.values()];
    if (decisions.some((r) => r.state === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
    if (decisions.some((r) => r.state === 'APPROVED')) return 'APPROVED';
    return 'NONE';
  }

  async mergePR(n, { mergeMethod = 'squash' } = {}) {
    this.calls.mergePR += 1;
    const pr = this.prs.find((p) => p.number === n);
    if (pr) {
      pr.state = 'closed';
      pr.merged = true;
    }
    const sha = this.mergeShaFactory ? await this.mergeShaFactory() : `merge-sha-${n}`;
    return { merged: true, sha, mergeMethod };
  }

  async ciSummary(ref) {
    const v = this.ci.get(ref);
    if (!v) return { state: 'none', failing: [], pending: [], succeeded: [], total: 0 };
    if (typeof v === 'string') {
      return {
        state: v,
        failing: v === 'failure' ? ['ci'] : [],
        pending: v === 'pending' ? ['ci'] : [],
        succeeded: v === 'success' ? ['ci'] : [],
        total: 1,
      };
    }
    return { ...v };
  }
}

const STUB_SOURCE = `#!/usr/bin/env node
// Stub DeepSeek Harness CLI for hermetic controller tests.
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const behavior = process.env.KHEYFLIX_TEST_STUB_BEHAVIOR || process.env.STUB_BEHAVIOR || 'success';
if (process.env.STUB_TASK_OUT) fs.writeFileSync(process.env.STUB_TASK_OUT, process.argv.slice(2).join(' '));
if (process.env.STUB_ENV_OUT) fs.writeFileSync(process.env.STUB_ENV_OUT, JSON.stringify(process.env));
if (behavior === 'hang') { setTimeout(() => {}, 60000); return; }
if (behavior === 'outage') { console.error('provider error: 429 rate limit exceeded'); process.exit(1); }
if (behavior === 'fail') { console.error('tests failed: assertion boom'); process.exit(1); }
if (behavior === 'no-commits') { process.exit(0); }
// success: leave a unique change and commit it
fs.writeFileSync('stub-change.txt', 'change ' + process.pid + ' ' + Date.now() + '\\n');
execFileSync('git', ['add', '-A']);
execFileSync('git', ['commit', '-m', 'stub change ' + Date.now()]);
`;

export async function makeStubHarness(dir) {
  const stub = path.join(dir, 'stub-harness.cjs');
  await fs.promises.writeFile(stub, STUB_SOURCE);
  await fs.promises.chmod(stub, 0o755);
  return stub;
}

/** Fake $DSH_HOME whose settings resolve to the required provider/model. */
export async function makeFakeDshHome(base, { provider = 'openrouter-ox', model = 'stealth/ox-alpha' } = {}) {
  const home = path.join(base, 'dsh-home');
  await fs.promises.mkdir(path.join(home, 'profiles', 'kheyflix-ox'), { recursive: true });
  await fs.promises.writeFile(
    path.join(home, 'settings.yaml'),
    [
      'llm-pi-ai:',
      '  providers:',
      '    openrouter-ox:',
      '      displayName: OpenRouter Ox Alpha',
      'agent-loop:',
      '  maxParallelToolCalls: 60',
      'agent-default-model:',
      `  provider: ${provider}`,
      `  model: "${model}"`,
      '',
    ].join('\n'),
  );
  return home;
}

export function nullStream() {
  return { write() {} };
}

/**
 * Wire a full Controller against hermetic fixtures. Env vars are set on
 * process.env (pushBranch/harnessChildEnv read it directly) and restored by
 * the returned cleanup function.
 */
export async function makeController({
  issues = [],
  closedIssueNumbers,
  stubBehavior = 'success',
  now0 = 1_700_000_000_000,
  config: configOverrides = {},
  env: extraEnv = {},
} = {}) {
  const { loadConfig } = await import('../src/config.js');
  const { Store } = await import('../src/db.js');
  const { Controller } = await import('../src/lifecycle.js');
  const { createLogger } = await import('../src/log.js');

  const fx = await makeRepoFixture();
  const stub = await makeStubHarness(fx.base);
  const dshHome = await makeFakeDshHome(fx.base);
  const env = {
    KHEYFLIX_REPO_PATH: fx.repoPath,
    KHEYFLIX_STATE_DIR: path.join(fx.base, 'state'),
    KHEYFLIX_REPO: 'test/kheyflix',
    KHEYFLIX_PUSH_URL: fx.originUrl,
    KHEYFLIX_HARNESS_CMD: stub,
    KHEYFLIX_GITHUB_TOKEN: 'ghp_testtokenvalue1234567890abcdef',
    KHEYFLIX_TEST_STUB_BEHAVIOR: stubBehavior,
    ...extraEnv,
  };
  const savedEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);

  const clock = { now: now0 };
  const config = loadConfig(env);
  config.dshHome = dshHome;
  config.ciPollMs = 5;
  Object.assign(config, configOverrides);

  const store = new Store(config.dbPath, { now: () => clock.now });
  const gh = new FakeGitHub();
  for (const i of issues) gh.addIssue(i);
  if (closedIssueNumbers) {
    for (const n of closedIssueNumbers) {
      const issue = gh.issues.find((i) => i.number === n);
      if (issue) issue.state = 'closed';
    }
  }
  const logger = createLogger({ stream: nullStream() });
  const controller = new Controller({
    config,
    store,
    gh,
    logger,
    clock: { now: () => clock.now, sleep: async (ms) => void (clock.now += ms) },
  });

  return {
    fx,
    stub,
    dshHome,
    clock,
    config,
    store,
    gh,
    logger,
    controller,
    cleanup() {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      try {
        store.close();
      } catch {}
      logger.close?.();
      fs.rmSync(fx.base, { recursive: true, force: true });
    },
  };
}

/** Drive controller.once() until a terminal/idle outcome or step budget. */
export async function drive(controller, { max = 30, filter = () => true } = {}) {
  const results = [];
  for (let i = 0; i < max; i++) {
    const r = await controller.once();
    results.push(r);
    if (!filter(r)) break;
    if (['completed', 'failed', 'reverted', 'idle', 'noop'].includes(r.action)) break;
  }
  return results;
}

/**
 * Drive with hosted-CI/review gates cleared automatically: whenever a run
 * waits on CI or manager review, register success/approval first. Tests that
 * inject failures do so explicitly before calling.
 */
export async function driveAuto(h, { max = 60 } = {}) {
  const results = [];
  for (let i = 0; i < max; i++) {
    const run = h.store.getActiveRun();
    if (run) {
      if (run.state === 'ci_pending' && run.head_sha) h.gh.setCi(run.head_sha, 'success');
      if (run.state === 'review_pending' && run.pr_number) h.gh.approve(run.pr_number);
    }
    const r = await h.controller.once();
    results.push(r);
    if (['completed', 'failed', 'reverted', 'idle', 'noop'].includes(r.action)) break;
  }
  return results;
}


