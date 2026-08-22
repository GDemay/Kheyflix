// Process locking: exactly one dispatcher instance per checkout, and the lock
// doubles as crash recovery — a stale lock (no heartbeat within staleMs) is
// broken deterministically by the next dispatcher.

import fs from 'node:fs';
import path from 'node:path';
import { hostTag } from './config.js';

export class LockBusyError extends Error {
  constructor(owner) {
    super(`another dispatcher holds the lock (owner=${owner})`);
    this.name = 'LockBusyError';
  }
}

export function acquireLock(dir, { staleMs = 10 * 60_000, now = () => Date.now(), retryMs = 250, retries = 3 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, 'dispatcher.lock');
  let lastOwner = null;
  let busyAttempts = 0;
  for (;;) {
    try {
      fs.mkdirSync(lockPath); // atomic on POSIX and Windows
      const owner = hostTag();
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ owner, at: now() }));
      return {
        path: lockPath,
        owner,
        heartbeat() {
          try {
            fs.utimesSync(lockPath, new Date(now() / 1000), new Date(now() / 1000));
          } catch {
            /* lock already released */
          }
        },
        release() {
          fs.rmSync(lockPath, { recursive: true, force: true });
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      lastOwner = readOwner(lockPath);
      if (isStale(lockPath, staleMs, now)) {
        // Previous holder crashed without releasing. Break the lock; this
        // does not count against the busy-retry budget.
        fs.rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (busyAttempts >= retries) throw new LockBusyError(lastOwner ?? 'unknown');
      busyAttempts += 1;
      const until = now() + retryMs;
      while (now() < until) {
        /* bounded spin; tests inject a fast clock */
      }
    }
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).owner;
  } catch {
    return 'unknown';
  }
}

export function isStale(lockPath, staleMs, now = () => Date.now()) {
  try {
    const mtimeMs = fs.statSync(lockPath).mtimeMs;
    return now() - mtimeMs > staleMs;
  } catch {
    return false;
  }
}
