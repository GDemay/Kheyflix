// SQLite persistence (node:sqlite, stdlib only). Holds the delivery state
// model plus an append-only event audit trail.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ACTIVE_STATES, TERMINAL_STATES } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL,
  issue_title TEXT NOT NULL,
  slug TEXT NOT NULL,
  branch TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'claimed',
  attempts INTEGER NOT NULL DEFAULT 0,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  outage_attempts INTEGER NOT NULL DEFAULT 0,
  pr_number INTEGER,
  pr_url TEXT,
  head_sha TEXT,
  merge_sha TEXT,
  last_error TEXT,
  next_attempt_at INTEGER,
  state_entered_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_state ON runs(state);
CREATE INDEX IF NOT EXISTS runs_issue ON runs(issue_number);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  from_state TEXT,
  to_state TEXT,
  detail TEXT
);
`;

export class Store {
  constructor(dbPath, { now = () => Date.now() } = {}) {
    this.now = now;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  /** node:sqlite on Node 22 has no .transaction(); use explicit BEGIN IMMEDIATE. */
  #transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  #run(row) {
    return row ? { ...row, active: ACTIVE_STATES.includes(row.state) } : null;
  }

  getRun(id) {
    return this.#run(this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id));
  }

  getRunByIssue(issueNumber) {
    return this.#run(
      this.db.prepare('SELECT * FROM runs WHERE issue_number = ? ORDER BY id DESC LIMIT 1').get(issueNumber),
    );
  }

  getRunByBranch(branch) {
    return this.#run(this.db.prepare('SELECT * FROM runs WHERE branch = ?').get(branch));
  }

  getActiveRun() {
    return this.#run(
      this.db
        .prepare(`SELECT * FROM runs WHERE state IN (${ACTIVE_STATES.map(() => '?').join(',')}) ORDER BY id LIMIT 1`)
        .get(...ACTIVE_STATES),
    );
  }

  listRuns({ state } = {}) {
    const rows = state
      ? this.db.prepare('SELECT * FROM runs WHERE state = ? ORDER BY id').all(state)
      : this.db.prepare('SELECT * FROM runs ORDER BY id').all();
    return rows.map((r) => this.#run(r));
  }

  /** Single-flight claim: at most one active run across the whole table. */
  claimIssue({ issueNumber, issueTitle, slug, branch }) {
    const tx = this.#transaction(() => {
      const active = this.db
        .prepare(`SELECT id FROM runs WHERE state IN (${ACTIVE_STATES.map(() => '?').join(',')}) LIMIT 1`)
        .get(...ACTIVE_STATES);
      if (active) return null;
      const existing = this.db
        .prepare('SELECT * FROM runs WHERE branch = ?')
        .get(branch);
      if (existing) {
        if (ACTIVE_STATES.includes(existing.state)) return null; // already active
        // Prior terminal run for the same branch (e.g. post-merge redo):
        // never resurrect completed deliveries; refuse duplicates.
        return null;
      }
      const now = this.now();
      const info = this.db
        .prepare(
          `INSERT INTO runs (issue_number, issue_title, slug, branch, state, state_entered_at, claimed_at, heartbeat_at)
           VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?)`,
        )
        .run(issueNumber, issueTitle, slug, branch, now, now, now);
      this.#event(Number(info.lastInsertRowid), null, 'claimed', `claimed issue #${issueNumber}`);
      return this.getRun(Number(info.lastInsertRowid));
    });
    return tx;
  }

  /**
   * Adopt a run discovered on GitHub during recovery (idempotent). Existing
   * rows only get their PR fields refreshed. New active rows respect the
   * single-flight rule: if another run is active, returns null (skipped).
   */
  adoptRun({ issueNumber, issueTitle, slug, branch, state, prNumber, prUrl, headSha }) {
    const tx = this.#transaction(() => {
      const existing = this.db.prepare('SELECT * FROM runs WHERE branch = ?').get(branch);
      const now = this.now();
      if (existing) {
        this.db
          .prepare(
            `UPDATE runs SET pr_number = COALESCE(?, pr_number), pr_url = COALESCE(?, pr_url),
             head_sha = COALESCE(head_sha, ?), heartbeat_at = ? WHERE id = ?`,
          )
          .run(prNumber ?? null, prUrl ?? null, headSha ?? null, now, existing.id);
        return this.getRun(existing.id);
      }
      if (ACTIVE_STATES.includes(state) && this.getActiveRun()) return null;
      const info = this.db
        .prepare(
          `INSERT INTO runs (issue_number, issue_title, slug, branch, state, pr_number, pr_url, head_sha,
             state_entered_at, claimed_at, heartbeat_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(issueNumber, issueTitle, slug, branch, state, prNumber ?? null, prUrl ?? null, headSha ?? null, now, now, now);
      const id = Number(info.lastInsertRowid);
      this.#event(id, null, state, `adopted from GitHub recovery (pr=${prNumber ?? 'none'})`);
      return this.getRun(id);
    });
    return tx;
  }

  setState(id, state, { detail, lastError, prNumber, prUrl, headSha, mergeSha, nextAttemptAt } = {}) {
    const tx = this.#transaction(() => {
      const run = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
      if (!run) throw new Error(`setState: unknown run ${id}`);
      const now = this.now();
      const terminal = TERMINAL_STATES.includes(state);
      this.db
        .prepare(
          `UPDATE runs SET state = ?, state_entered_at = ?, heartbeat_at = ?,
             last_error = COALESCE(?, last_error),
             pr_number = COALESCE(?, pr_number),
             pr_url = COALESCE(?, pr_url),
             head_sha = COALESCE(?, head_sha),
             merge_sha = COALESCE(?, merge_sha),
             next_attempt_at = ?,
             finished_at = ${terminal ? '?' : 'finished_at'}
           WHERE id = ?`,
        )
        .run(
          state,
          now,
          now,
          lastError ?? null,
          prNumber ?? null,
          prUrl ?? null,
          headSha ?? null,
          mergeSha ?? null,
          nextAttemptAt ?? null,
          ...(terminal ? [now] : []),
          id,
        );
      if (run.state !== state || detail) {
        this.#event(id, run.state, state, detail ?? lastError ?? null);
      }
      return this.getRun(id);
    });
    return tx;
  }

  heartbeat(id) {
    this.db.prepare('UPDATE runs SET heartbeat_at = ? WHERE id = ?').run(this.now(), id);
  }

  incrementAttempts(id) {
    this.db.prepare('UPDATE runs SET attempts = attempts + 1 WHERE id = ?').run(id);
    return this.getRun(id);
  }

  incrementRepairAttempts(id) {
    this.db.prepare('UPDATE runs SET repair_attempts = repair_attempts + 1 WHERE id = ?').run(id);
    return this.getRun(id);
  }

  incrementOutageAttempts(id) {
    this.db.prepare('UPDATE runs SET outage_attempts = outage_attempts + 1 WHERE id = ?').run(id);
    return this.getRun(id);
  }

  #event(runId, fromState, toState, detail) {
    this.db
      .prepare('INSERT INTO events (run_id, at, from_state, to_state, detail) VALUES (?, ?, ?, ?, ?)')
      .run(runId, this.now(), fromState, toState, detail ?? null);
  }

  events(runId) {
    return this.db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY id').all(runId);
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }
}
