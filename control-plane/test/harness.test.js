// Harness driver: fail-closed preflight, child-env isolation, classification,
// and prompt composition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PreflightError,
  preflight,
  readAgentDefaultModel,
  runHarness,
  classifyFailure,
  buildTaskPrompt,
} from '../src/harness.js';
import { makeController, makeFakeDshHome, tmpDir } from './helpers.js';

const SETTINGS_OK = { provider: 'openrouter-ox', model: 'stealth/ox-alpha' };

test('preflight passes only for exactly openrouter-ox/stealth/ox-alpha', async (t) => {
  const base = await tmpDir('preflight-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = await makeFakeDshHome(base, SETTINGS_OK);
  const stub = path.join(base, 'cmd');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(stub, 0o755);

  const ok = preflight({ dshHome: home, profile: 'kheyflix-ox', harnessCmd: stub });
  assert.deepEqual(ok, { provider: 'openrouter-ox', model: 'stealth/ox-alpha', profile: 'kheyflix-ox' });

  // Wrong model → fail closed. No fallback is attempted.
  const badModel = await makeFakeDshHome(path.join(base, 'b1'), { provider: 'openrouter-ox', model: 'deepseek-v4-flash' });
  assert.throws(() => preflight({ dshHome: badModel, profile: 'kheyflix-ox', harnessCmd: stub }), (err) => {
    assert.ok(err instanceof PreflightError);
    assert.match(err.message, /model resolved to 'deepseek-v4-flash'/);
    return true;
  });

  // Wrong provider → fail closed.
  const badProvider = await makeFakeDshHome(path.join(base, 'b2'), { provider: 'openai', model: 'stealth/ox-alpha' });
  assert.throws(() => preflight({ dshHome: badProvider, profile: 'kheyflix-ox', harnessCmd: stub }), /provider resolved to 'openai'/);

  // Missing profile → fail closed.
  assert.throws(() => preflight({ dshHome: home, profile: 'does-not-exist', harnessCmd: stub }), /profile 'does-not-exist' not found/);

  // Missing binary → fail closed.
  assert.throws(() => preflight({ dshHome: home, profile: 'kheyflix-ox', harnessCmd: 'definitely-not-installed-anywhere' }), /harness command/);
});

test('readAgentDefaultModel parses quotes and comments and stops at next key', () => {
  const yaml = [
    '# comment',
    'ui-onboarding:',
    '  welcomeNoticeVersion: x',
    'agent-default-model:',
    '  provider: openrouter-ox # inline comment',
    '  model: "stealth/ox-alpha"',
    'permission:',
    '  defaultPreset: danger-full-access',
  ].join('\n');
  assert.deepEqual(readAgentDefaultModel(yaml), SETTINGS_OK);
  assert.equal(readAgentDefaultModel('nothing: here'), null);
});

test('controller refuses to start on a mismatched settings file', async (t) => {
  const h = await makeController({
    issues: [{ number: 1, title: 'x', labels: [{ name: 'agent:ready' }] }],
  });
  t.after(h.cleanup);
  h.config.dshHome = await makeFakeDshHome(h.fx.base + '-bad', {
    provider: 'some-other-provider',
    model: 'stealth/ox-alpha',
  });
  assert.throws(() => h.controller.preflightHarness(), PreflightError);
});

test('Harness child env is an allowlist: no tokens, keys, or credentials leak in', async (t) => {
  const h = await makeController({ issues: [] });
  t.after(h.cleanup);
  const envOut = path.join(h.fx.base, 'child-env.json');
  process.env.OPENROUTER_API_KEY = 'sk-or-leakykeyvalue123456';
  try {
    const result = await runHarness({
      harnessCmd: h.stub,
      profile: h.config.harnessProfile,
      task: 'dump env',
      cwd: h.fx.repoPath,
      timeoutMs: 30_000,
      transcriptPath: path.join(h.fx.base, 'transcript.log'),
      childEnvExtra: {
        GIT_AUTHOR_NAME: 'Ox Alpha (control plane)',
        GIT_AUTHOR_EMAIL: 'ox-alpha@kheyflix.local',
        STUB_ENV_OUT: envOut,
        STUB_TASK_OUT: path.join(h.fx.base, 'task-out.txt'),
      },
      now: () => h.clock.now,
      sleep: async () => {},
    });
    assert.equal(result.code, 0);
    const child = JSON.parse(fs.readFileSync(envOut, 'utf8'));
    assert.equal(child.KHEYFLIX_GITHUB_TOKEN, undefined, 'controller token must never reach Harness');
    assert.equal(child.GITHUB_TOKEN, undefined);
    assert.equal(child.OPENROUTER_API_KEY, undefined, 'provider API key must never reach Harness env');
    assert.equal(child.STUB_BEHAVIOR, undefined, 'no environment dump is passed through');
    assert.equal(child.PATH, process.env.PATH);
    assert.equal(child.HOME, process.env.HOME);
    assert.equal(child.GIT_AUTHOR_NAME, 'Ox Alpha (control plane)');
  } finally {
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('failures classify as timeout, model outage, or task failure', () => {
  assert.equal(classifyFailure({ code: null, signal: 'SIGKILL', timedOut: true }), 'timeout');
  assert.equal(classifyFailure({ code: 0, timedOut: false }), 'success');
  assert.equal(classifyFailure({ code: 1, stderrTail: 'provider error: 429 rate limit exceeded' }), 'model_outage');
  assert.equal(classifyFailure({ code: 1, stderrTail: 'upstream error while streaming' }), 'model_outage');
  assert.equal(classifyFailure({ code: 1, stderrTail: 'SyntaxError: unexpected token' }), 'task_failed');
  assert.equal(classifyFailure(null), 'unknown');
});

test('task prompts contain only permitted content plus hard rules', () => {
  const prompt = buildTaskPrompt({
    mode: 'implement',
    issue: { number: 7, title: 'build it', body: 'do the thing\ndepends-on: none' },
    repoPath: '/repo',
    evidence: 'CI failed: lint',
  });
  assert.match(prompt, /Issue #7: build it/);
  assert.match(prompt, /do the thing/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /Never print, commit, or exfiltrate secrets or tokens\./);
  assert.match(prompt, /Do not push/);
  assert.match(prompt, /CI failed: lint/);
  const repair = buildTaskPrompt({ mode: 'repair', issue: { number: 7, title: 't', body: '' }, repoPath: '/r' });
  assert.match(repair, /repairing delivery for issue #7/i);
});
