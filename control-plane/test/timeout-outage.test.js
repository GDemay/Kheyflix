// Harness timeouts and provider/model outages: bounded retries, backoff, and
// eventual deterministic failure without ever creating a PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeController } from './helpers.js';

test('harness timeout kills the child, records the attempt, retries once, then fails', async (t) => {
  const h = await makeController({
    issues: [{ number: 61, title: 'hangs forever', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'hang',
    config: { harnessTimeoutMs: 400 },
  });
  t.after(h.cleanup);

  const started = Date.now();
  const first = await h.controller.once();
  assert.equal(first.action, 'parked');
  assert.match(first.reason, /timeout/);
  assert.ok(Date.now() - started < 15_000, 'the hung child was actually killed');

  let run = h.store.getRunByIssue(61);
  assert.equal(run.attempts, 1);
  assert.equal(run.state, 'claimed', 'scheduled for retry');

  h.clock.now += 31_000; // clear retry backoff
  const second = await h.controller.once();
  assert.equal(second.action, 'failed');
  run = h.store.getRunByIssue(61);
  assert.equal(run.state, 'failed');
  assert.match(run.last_error ?? '', /timed out/);
  assert.equal(h.gh.calls.createPR, 0, 'no PR is ever opened from a timed-out run');
});

test('model outages back off exponentially and fail closed after the budget', async (t) => {
  const h = await makeController({
    issues: [{ number: 62, title: 'provider down', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'outage',
    config: { modelOutageMaxAttempts: 3, modelOutageBackoffMs: 1000 },
  });
  t.after(h.cleanup);

  // Outage 1 → parked with backoff.
  const r1 = await h.controller.once();
  assert.equal(r1.action, 'parked');
  assert.equal(h.store.getRunByIssue(62).outage_attempts, 1);

  // Still within the backoff window → parked again without a new attempt.
  const r2 = await h.controller.once();
  assert.equal(r2.action, 'parked');
  assert.equal(h.store.getRunByIssue(62).outage_attempts, 1);

  h.clock.now += 1001;
  await h.controller.once(); // outage 2
  h.clock.now += 2001;
  const final = await h.controller.once(); // outage 3 == budget → failed
  assert.equal(final.action, 'failed');

  const run = h.store.getRunByIssue(62);
  assert.equal(run.state, 'failed');
  assert.equal(run.outage_attempts, 3);
  assert.match(run.last_error ?? '', /model outage persisted/);
  assert.equal(h.gh.calls.createPR, 0);
});
