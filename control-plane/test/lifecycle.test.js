// Full lifecycle: claim → Ox run → push/PR → hosted CI → review → merge →
// post-merge CI → completed. Uses the stub Harness and a local bare origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeController, drive, driveAuto, g } from './helpers.js';

test('happy path delivers one issue end to end', async (t) => {
  const h = await makeController({
    issues: [{ number: 7, title: '[AUTONOMY] Bootstrap control plane', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  await driveAuto(h);
  const run = h.store.getRunByIssue(7);
  assert.equal(run.state, 'completed');

  // Deterministic branch, exactly one PR, merged, branch present on origin.
  assert.equal(run.branch, 'agent/issue-7-autonomy-bootstrap-control-plane');
  assert.equal(h.gh.calls.createPR, 1);
  const pr = h.gh.prs[0];
  assert.equal(pr.merged, true);
  assert.equal(run.pr_number, pr.number);
  const remote = await g(['for-each-ref', 'refs/heads', '--format=%(refname:short)'], { cwd: h.fx.originUrl });
  assert.match(remote, /agent\/issue-7-autonomy-bootstrap-control-plane/);

  // Event trail covers every lifecycle phase.
  const states = h.store.events(run.id).map((e) => e.to_state);
  for (const expected of ['claimed', 'ox_running', 'pushing', 'ci_pending', 'review_pending', 'merging', 'post_merge_pending', 'completed']) {
    assert.ok(states.includes(expected), `missing state ${expected} in ${states.join(',')}`);
  }
});

test('CI failure triggers an Ox repair on the same branch and reuses the PR', async (t) => {
  const h = await makeController({
    issues: [{ number: 5, title: 'fix the widget', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'ci_pending') });
  let run = h.store.getRunByIssue(5);
  assert.equal(run.state, 'ci_pending');
  assert.equal(h.gh.calls.createPR, 1);

  h.gh.setCi(run.head_sha, 'failure');
  await h.controller.once();
  run = h.store.getRunByIssue(5);
  assert.equal(run.state, 'ci_failed');
  assert.ok(h.store.getMeta(`evidence-ci-${run.id}`), 'focused CI evidence stored');

  await driveAuto(h);
  run = h.store.getRunByIssue(5);
  assert.equal(run.state, 'completed');
  assert.equal(run.repair_attempts, 1);
  assert.equal(h.gh.calls.createPR, 1, 'repair reuses the original PR');
});

test('manager CHANGES_REQUESTED triggers repair; later approval allows merge', async (t) => {
  const h = await makeController({
    issues: [{ number: 9, title: 'reviewable feature', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'review_pending') });
  let run = h.store.getRunByIssue(9);
  assert.equal(run.state, 'review_pending');

  h.gh.requestChanges(run.pr_number, 'please split the module and add tests');
  await h.controller.once();
  run = h.store.getRunByIssue(9);
  assert.equal(run.state, 'review_changes');
  assert.match(h.store.getMeta(`evidence-review-${run.id}`) ?? '', /split the module/);

  await driveAuto(h);
  run = h.store.getRunByIssue(9);
  assert.equal(run.state, 'completed');
  assert.equal(run.repair_attempts, 1);
  assert.equal(h.gh.calls.createPR, 1);
});

test('repair budget exhaustion fails the run instead of looping forever', async (t) => {
  const h = await makeController({
    issues: [{ number: 13, title: 'doomed feature', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
    config: { repairMaxAttempts: 1 },
  });
  t.after(h.cleanup);

  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'ci_pending') });
  let run = h.store.getRunByIssue(13);
  h.gh.setCi(run.head_sha, 'failure');
  await h.controller.once(); // → ci_failed
  assert.equal(h.store.getRunByIssue(13).state, 'ci_failed');

  // Repair 1 runs and pushes a new head; hosted CI fails on that head too.
  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'ci_pending') });
  run = h.store.getRunByIssue(13);
  assert.equal(run.repair_attempts, 1);
  h.gh.setCi(run.head_sha, 'failure');
  await h.controller.once(); // → ci_failed (second time)

  // Repair 2 would exceed the budget: the run fails instead of looping.
  const outcome = await h.controller.once();
  assert.equal(outcome.action, 'failed');
  run = h.store.getRunByIssue(13);
  assert.equal(run.state, 'failed');
  assert.match(run.last_error ?? '', /repair budget exhausted/);
});

test('review timeout parks then fails deterministically', async (t) => {
  const h = await makeController({
    issues: [{ number: 11, title: 'needs review', labels: [{ name: 'agent:ready' }], created_at: '2026-01-01T00:00:00Z' }],
    config: { reviewTimeoutMs: 1000 },
  });
  t.after(h.cleanup);

  await drive(h.controller, { filter: (r) => !(r.action === 'advanced' && r.state === 'review_pending') });
  let run = h.store.getRunByIssue(11);
  assert.equal(run.state, 'review_pending');

  const parked = await h.controller.once();
  assert.equal(parked.action, 'parked');
  h.clock.now += 2000;
  const failed = await h.controller.once();
  assert.equal(failed.action, 'failed');
  assert.equal(failed.reason, 'review_timeout');
  run = h.store.getRunByIssue(11);
  assert.equal(run.state, 'failed');
});
