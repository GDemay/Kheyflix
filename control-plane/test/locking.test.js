// Process locking, single-flight claims, and stale lock breaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, LockBusyError, isStale } from '../src/lock.js';
import { makeController } from './helpers.js';

test('only one dispatcher can hold the lock at a time', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = acquireLock(dir);
  assert.throws(() => acquireLock(dir, { retries: 0 }), LockBusyError);
  lock.release();
  const again = acquireLock(dir); // released lock can be re-acquired
  again.release();
});

test('stale locks are broken deterministically; fresh locks are respected', async (t) => {
  const dir = fs.mkdtempSync('kheyflix-lock2-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const holder = acquireLock(dir);
  // A dispatcher with a clock far in the future sees the lock as stale:
  const futureNow = () => Date.now() + 60 * 60_000;
  assert.equal(isStale(holder.path, 10 * 60_000, futureNow), true);
  const stolen = acquireLock(dir, { staleMs: 10 * 60_000, now: futureNow, retries: 0 });
  stolen.release();
  holder.release();
});

test('one run at a time: an active run blocks claiming further issues', async (t) => {
  const h = await makeController({
    issues: [
      { number: 1, title: 'first', labels: [{ name: 'agent:ready' }] },
      { number: 2, title: 'second', labels: [{ name: 'agent:ready' }] },
    ],
    stubBehavior: 'no-commits',
  });
  t.after(h.cleanup);

  // First claim succeeds; harness produces no commits so the run parks for retry.
  let r = await h.controller.once();
  assert.equal(r.action, 'parked'); // task_failed retry scheduled
  const active = h.store.getActiveRun();
  assert.ok(active, 'run is active');
  assert.equal(active.branch, 'agent/issue-1-first');
  assert.equal(h.store.claimIssue({ issueNumber: 9, issueTitle: 'x', slug: 'x', branch: 'other' }), null,
    'claiming while another run is active is refused');
  assert.equal(h.store.getActiveRun().id, active.id, 'still the same single active run');

  // Terminal state frees the slot.
  h.store.setState(active.id, 'failed', { lastError: 'test cleanup' });
  r = await h.controller.once();
  assert.equal(r.action, 'parked', 'second issue now claimed and parked on its own retry');
  assert.notEqual(h.store.getActiveRun().branch, 'agent/issue-1-first');
});
