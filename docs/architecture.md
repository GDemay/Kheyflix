# Kheyflix delivery control plane — architecture

An agent-only monorepo. Humans (the manager) label issues and review PRs; all
code, commits, and delivery mechanics are owned by Ox Alpha through DeepSeek
Harness. The control plane runs locally (macOS, launchd every 5 minutes) and
drives DeepSeek Harness **headlessly** with the dedicated `kheyflix-ox`
profile, locked to exactly `openrouter-ox/stealth/ox-alpha`.

## Components

```
control-plane/
├── bin/kheyflix.js        CLI: preflight | dry-run | once | run | recover | status
└── src/
    ├── config.js          env-driven config + hard model constants
    ├── redact.js          credential scrubbing (defense in depth)
    ├── log.js             redacting console + JSONL transcript logger
    ├── db.js              SQLite persistence (node:sqlite), state model
    ├── lock.js            single-dispatcher process lock, stale breaking
    ├── branches.js        deterministic agent/issue-<n>-<slug> naming
    ├── issues.js          label-anchored trust, priority, dependencies
    ├── github.js          minimal REST client (controller-only token)
    ├── harness.js         fail-closed preflight + headless dsh driver
    ├── gitops.js          worktrees, pushes, revert containment
    ├── recover.js         GitHub + SQLite reconciliation on every start
    └── lifecycle.js       resumable delivery state machine
```

No runtime dependencies. Node >= 22.5 standard library only. All controller
tests are hermetic: a local bare git origin, an in-memory GitHub double, and a
stub Harness CLI (`control-plane/test/`).

## State model (SQLite at `.kheyflix/state.db`)

- `runs` — one row per deterministic branch:
  `state, attempts, repair_attempts, outage_attempts, pr_number, head_sha,
  merge_sha, next_attempt_at, state_entered_at, heartbeat_at, …`
- `events` — append-only audit trail of every state transition.
- `meta` — issue bodies captured at claim time and per-run evidence.

Active states: `claimed → ox_running → pushing → pr_open/ci_pending →
(ci_failed → repairing) → review_pending → (review_changes → repairing) →
merging → post_merge_pending → completed`, plus `failed` and `reverted`
terminals. Every `kheyflix once()` advances the active run by at most one
step and **parks** on remote waits (CI pending, review pending, backoff), so
launchd ticks make incremental progress and any crash is resumable.

## Lifecycle

```
claim → Ox run → controller push/PR → hosted CI → manager review check
      → Ox repair (if needed) → merge → post-merge main CI → next issue
```

1. **Preflight (fail closed).** Parse `$DSH_HOME/settings.yaml`; require
   `provider == openrouter-ox` and `model == stealth/ox-alpha` exactly, the
   `kheyflix-ox` profile directory, and the `dsh` binary. Any mismatch aborts
   before any side effect. There is **no fallback model**.
2. **Select one issue.** Only issues labeled `agent:ready` by the manager are
   executable (`agent:hold` excludes; optional `KHEYFLIX_TRUSTED_LOGINS`
   restricts authors). Priority `agent:priority:<n>` (lower wins), then
   oldest, then lowest number. Issues whose `depends-on: #N` declarations are
   not closed are skipped. Issues that already have a run row are never
   re-selected (terminal runs need manager action).
3. **Claim (single-flight).** SQLite transaction guarantees at most one active
   run; a directory-based lock guarantees at most one dispatcher. Stale locks
   and stale heartbeats are broken/requeued deterministically.
4. **Ox run.** `dsh --profile kheyflix-ox "<task>"` in a dedicated git
   worktree on branch `agent/issue-<n>-<slug>`. The task prompt contains only
   the checkout path, AGENTS.md/architecture pointers, the issue, and focused
   evidence. The child env is an allowlist (no tokens, no env dump). Hard
   timeout (SIGTERM→SIGKILL); failures classify as `timeout`,
   `model_outage` (exponential backoff, dedicated budget), or `task_failed`
   (bounded retries).
5. **Controller push/PR.** The controller (never Harness) pushes via an
   env-fed inline credential helper and opens the PR. Duplicate prevention:
   DB record → GitHub head-branch lookup → 422-race adoption. One canonical
   PR per issue (lowest number); duplicates found during recovery are closed.
   Fork PRs are never adopted, closed, or merged.
6. **Hosted CI.** Poll check-runs + statuses for the head SHA. `none`
   (bootstrap) counts as green. Timeout converts to a repair with evidence.
7. **Manager review check.** Latest decisive review: `APPROVED` → merge;
   `CHANGES_REQUESTED` → Ox repair with the review text as evidence; none →
   park until `reviewTimeoutMs`.
8. **Repair.** Same branch, same PR, evidence-bounded (`ci_failed` or
   `review_changes`), capped by `repairMaxAttempts`, then `failed`.
9. **Merge & post-merge.** Squash-merge via API, then watch CI on the merge
   commit. Green → `completed`. Regression → one deterministic hotfix run on
   `<branch>-postmerge` (full machine again). A regressing hotfix is
   contained by reverting the hotfix and original merges on main, then
   `reverted` with a PR comment for the manager.

## Restart recovery

Every start runs `recover.reconcile()`: GitHub branches/PRs are adopted into
SQLite (idempotent), duplicate PRs are closed, out-of-band merges/closes are
recognized, stale claimed runs are requeued or failed, and fork PRs are
ignored. Combined with deterministic branch names, restarts never produce
duplicate branches, runs, or PRs.

## Trust boundaries

- Only manager-labeled issues execute; arbitrary public issue text and fork
  PRs are ignored.
- Harness receives: checkout, issue/architecture instructions, focused
  CI/review evidence. Never: GitHub App keys, deploy keys, installation
  tokens, manager credentials, environment dumps (see `docs/secrets.md`).
- Product streaming work is limited to owned, test, or public-domain media;
  no index scraping, DRM bypass, credential sharing, or copyrighted catalog.
