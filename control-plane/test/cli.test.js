// CLI smoke tests: fail-closed preflight, fixture dry-run, secrets guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFakeDshHome, makeStubHarness, tmpDir, makeRepoFixture } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/kheyflix.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function cli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, cwd: ROOT }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

test('kheyflix preflight succeeds on exact resolution and fails closed otherwise', async (t) => {
  const base = await tmpDir('cli-preflight-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = await makeFakeDshHome(base);
  const stub = await makeStubHarness(base);
  const stateDir = path.join(base, 'state');

  const good = await cli(['preflight'], {
    DSH_HOME: home,
    KHEYFLIX_HARNESS_CMD: stub,
    KHEYFLIX_STATE_DIR: stateDir,
    KHEYFLIX_DB: path.join(stateDir, 'state.db'),
    KHEYFLIX_REPO_PATH: base,
  });
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /provider: openrouter-ox/);
  assert.match(good.stdout, /model:\s+stealth\/ox-alpha/);
  assert.match(good.stdout, /preflight OK/);

  const badHome = await makeFakeDshHome(path.join(base, 'bad'), { provider: 'fallback-provider', model: 'stealth/ox-alpha' });
  const bad = await cli(['preflight'], {
    DSH_HOME: badHome,
    KHEYFLIX_HARNESS_CMD: stub,
    KHEYFLIX_STATE_DIR: path.join(base, 'state2'),
    KHEYFLIX_DB: path.join(base, 'state2', 'state.db'),
    KHEYFLIX_REPO_PATH: base,
  });
  assert.equal(bad.code, 3, 'fail-closed exit code');
  assert.match(bad.stderr, /FAIL CLOSED|fail closed/);
  assert.match(bad.stderr, /fallback-provider/);
});

test('kheyflix dry-run selects exactly one issue from a fixture without any network', async (t) => {
  const base = await tmpDir('cli-dryrun-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = await makeFakeDshHome(base);
  const stub = await makeStubHarness(base);
  const fx = await makeRepoFixture();

  const fixture = path.join(base, 'issues.json');
  fs.writeFileSync(
    fixture,
    JSON.stringify({
      issues: [
        { number: 7, title: 'not labeled', state: 'open', labels: [], user: { login: 'manager' }, created_at: '2026-01-01T00:00:00Z' },
        { number: 9, title: 'blocked by dep', state: 'open', labels: [{ name: 'agent:ready' }], body: 'depends-on: #100', user: { login: 'manager' }, created_at: '2026-01-02T00:00:00Z' },
        { number: 11, title: 'the chosen one', state: 'open', labels: [{ name: 'agent:ready' }], user: { login: 'manager' }, created_at: '2026-01-03T00:00:00Z' },
        { number: 12, title: 'lower priority', state: 'open', labels: [{ name: 'agent:priority:6' }], user: { login: 'manager' }, created_at: '2026-01-01T00:00:00Z' },
      ],
      closedIssueNumbers: [],
    }),
  );

  const res = await cli(['dry-run', '--fixture', fixture], {
    DSH_HOME: home,
    KHEYFLIX_HARNESS_CMD: stub,
    KHEYFLIX_STATE_DIR: path.join(base, 'state'),
    KHEYFLIX_DB: path.join(base, 'state', 'state.db'),
    KHEYFLIX_REPO_PATH: fx.repoPath,
  });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /provider: openrouter-ox/);
  assert.match(res.stdout, /model:\s+stealth\/ox-alpha/);
  assert.match(res.stdout, /selected exactly one eligible issue:/);
  assert.match(res.stdout, /#11 the chosen one/);
  assert.match(res.stdout, /branch: agent\/issue-11-the-chosen-one/);
});

test('secrets guard passes on this repository', async (t) => {
  const res = await new Promise((resolve) =>
    execFile(process.execPath, [path.join(ROOT, 'control-plane/scripts/guard-secrets.mjs')], { cwd: ROOT }, (e, o, er) =>
      resolve({ code: e?.code ?? 0, out: o + er }),
    ),
  );
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /clean/);
});
