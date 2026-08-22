// Duplicate PR prevention and untrusted-source rejection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeController, driveAuto } from './helpers.js';
import { branchForIssue } from '../src/branches.js';
import { reconcile } from '../src/recover.js';

test('an existing open PR for the deterministic branch is adopted, never duplicated', async (t) => {
  const h = await makeController({
    issues: [{ number: 41, title: 'already opened', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);
  h.gh.addPR({ number: 55, head: branchForIssue(41, 'already opened'), issueNumber: 41 });

  await driveAuto(h);
  const run = h.store.getRunByIssue(41);
  assert.equal(run.state, 'completed');
  assert.equal(run.pr_number, 55);
  assert.equal(h.gh.calls.createPR, 0, 'no second PR was created');
});

test('a concurrent create (HTTP 422) recovers by adopting the winning PR', async (t) => {
  const h = await makeController({
    issues: [{ number: 42, title: 'race', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);
  h.gh.createPR = async (args) => {
    h.gh.addPR({ number: 77, head: args.head }); // the "other" winner lands first
    const err = new Error('validation failed; PR already exists');
    err.status = 422;
    throw err;
  };

  await driveAuto(h);
  const run = h.store.getRunByIssue(42);
  assert.equal(run.state, 'completed');
  assert.equal(run.pr_number, 77, 'adopted the existing PR instead of duplicating');
});

test('recovery keeps one canonical PR per issue and closes duplicates; fork PRs are untouchable', async (t) => {
  const h = await makeController({ issues: [] });
  t.after(h.cleanup);
  h.gh.branches.add('agent/issue-50-dup');
  h.gh.addPR({ number: 60, head: 'agent/issue-50-dup' });
  h.gh.addPR({ number: 61, head: 'agent/issue-50-dup' });
  // Fork PR from an unrelated repo with an agent-shaped head: must be ignored.
  const fork = h.gh.addPR({ number: 62, head: 'agent/issue-51-sneaky', fork: true });

  const summary = await reconcile({ store: h.store, gh: h.gh, config: h.config, logger: h.logger, now: () => h.clock.now });
  assert.deepEqual(summary.closedDuplicates, [61]);
  assert.equal(summary.ignoredForkPRs, 1);
  assert.equal(fork.state, 'open', 'fork PR was not closed');
  assert.equal(h.store.getRunByBranch('agent/issue-51-sneaky'), null, 'fork PR not adopted');
  assert.equal(h.store.getRunByBranch('agent/issue-50-dup').pr_number, 60);

  // Idempotent: running recovery twice changes nothing further.
  const again = await reconcile({ store: h.store, gh: h.gh, config: h.config, logger: h.logger, now: () => h.clock.now });
  assert.deepEqual(again.closedDuplicates, []);
});

test('untrusted-author issues are skipped even when labeled agent:ready', async (t) => {
  const h = await makeController({
    issues: [{ number: 43, title: 'drive-by', labels: [{ name: 'agent:ready' }], user: { login: 'stranger' } }],
    config: { trustedLogins: ['manager'] },
    stubBehavior: 'success',
  });
  t.after(h.cleanup);
  const r = await h.controller.once();
  assert.equal(r.action, 'idle');
  assert.equal(h.store.listRuns().length, 0);
});

test('issues without the manager label are never selected by the live loop', async (t) => {
  const h = await makeController({
    issues: [{ number: 44, title: 'plain issue, no label', labels: [] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);
  const r = await h.controller.once();
  assert.equal(r.action, 'idle');
});
