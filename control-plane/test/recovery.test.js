// Stale recovery, restart recovery (GitHub + SQLite), and out-of-band merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.js';
import { Controller } from '../src/lifecycle.js';
import { reconcile } from '../src/recover.js';
import { makeController, drive, driveAuto } from './helpers.js';

function restarted(h) {
  // Simulate a process restart: fresh Store + Controller over the same
  // SQLite file and the same GitHub state.
  const store = new Store(h.config.dbPath, { now: () => h.clock.now });
  const controller = new Controller({
    config: h.config,
    store,
    gh: h.gh,
    logger: h.logger,
    clock: { now: () => h.clock.now, sleep: async (ms) => void (h.clock.now += ms) },
  });
  const handle = { ...h, store, controller };
  return handle;
}

test('restart during ox_running marks the attempt and retries without duplicates', async (t) => {
  const h = await makeController({
    issues: [{ number: 21, title: 'crash survivor', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  await h.controller.once(); // claim + first Ox attempt → pushing
  let run = h.store.getRunByIssue(21);
  h.store.setState(run.id, 'ox_running', { detail: 'simulated crash mid-run' });

  const h2 = restarted(h);
  const r = await h2.controller.once();
  assert.equal(r.action, 'parked', 'interrupted attempt is retried with backoff');
  run = h2.store.getRunByIssue(21);
  assert.equal(run.attempts, 1);

  h.clock.now += 31_000; // clear retry backoff
  await driveAuto(h2);
  run = h2.store.getRunByIssue(21);
  assert.equal(run.state, 'completed');
  assert.equal(h.gh.calls.createPR, 1, 'exactly one PR across the restart');
  assert.equal(h2.store.listRuns().filter((x) => x.issue_number === 21).length, 1);
});

test('restart while awaiting CI resumes from GitHub state; no duplicate branch/PR/run', async (t) => {
  const h = await makeController({
    issues: [{ number: 22, title: 'resume me', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'ci_pending') });
  const before = h.store.getRunByIssue(22);

  const h2 = restarted(h);
  h.clock.now += 5 * 60_000;
  const r = await h2.controller.once();
  assert.equal(r.action, 'advanced');
  assert.equal(r.state, 'review_pending');

  const after = h2.store.getRunByIssue(22);
  assert.equal(after.id, before.id, 'same run row, no duplicate run');
  assert.equal(after.pr_number, before.pr_number, 'same PR, no duplicate PR');
  assert.equal(h.gh.calls.createPR, 1);

  h.gh.approve(after.pr_number);
  await driveAuto(h2);
  assert.equal(h2.store.getRunByIssue(22).state, 'completed');
});

test('stale claimed runs are requeued; exhausted attempts fail instead', async (t) => {
  const h = await makeController({
    issues: [],
    stubBehavior: 'success',
    config: { heartbeatStaleMs: 1000 },
  });
  t.after(h.cleanup);

  const run = h.store.claimIssue({ issueNumber: 30, issueTitle: 'orphan', slug: 'orphan', branch: 'agent/issue-30-orphan' });
  h.store.db.prepare('UPDATE runs SET heartbeat_at = ? WHERE id = ?').run(h.clock.now - 60_000, run.id);

  // Fresh heartbeat would be respected; stale one triggers recovery.
  const summary = await reconcile({ store: h.store, gh: h.gh, config: h.config, logger: h.logger, now: () => h.clock.now });
  assert.deepEqual(summary.requeued, [run.id]);
  assert.equal(h.store.getRun(run.id).state, 'claimed');

  // Exhausted attempts: stale runs fail deterministically.
  h.store.incrementAttempts(run.id);
  h.store.incrementAttempts(run.id); // attempts = 2 == harnessMaxAttempts
  h.store.db.prepare('UPDATE runs SET heartbeat_at = ? WHERE id = ?').run(h.clock.now - 60_000, run.id);
  const s2 = await reconcile({ store: h.store, gh: h.gh, config: h.config, logger: h.logger, now: () => h.clock.now });
  assert.deepEqual(s2.failed, [run.id]);
  assert.equal(h.store.getRun(run.id).state, 'failed');
});

test('PRs merged out-of-band are recognized as completed during restart', async (t) => {
  const h = await makeController({
    issues: [{ number: 23, title: 'external merge', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);
  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'ci_pending') });
  const run = h.store.getRunByIssue(23);
  h.gh.prs.find((p) => p.number === run.pr_number).merged = true;

  const h2 = restarted(h);
  await h2.controller.once();
  assert.equal(h2.store.getRunByIssue(23).state, 'completed');
});
