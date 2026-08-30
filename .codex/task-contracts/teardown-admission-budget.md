# Task contract: Bounded playback teardown admission

## Goal alignment

- Active goal objective: Deliver a production-ready, Netflix-quality Kheyflix: establish a measured baseline; eliminate P0/P1 streaming, reliability, performance, security, and product-experience issues; add regression coverage and observability; and safely deliver every change through the required GDemay/Kheyflix PR, CI/CD, production-health, and real laptop/iPhone Safari playback verification workflow.
- Authoritative inputs: User mission and follow-up authorization; `AGENTS.md`; `docs/quality-backlog.md`; `.github/workflows/ci.yml`; the exact production logs for merge `3034a398706f72d552b68a6c9cf134218964649e`; `scripts/transcoder.mjs`; `app/streaming-player.tsx`; and the real-title production playback tests.
- Baseline revision: `3034a398706f72d552b68a6c9cf134218964649e` from canonical `origin/main`, isolated in `originator/teardown-admission-budget`.
- Verifiable stopping condition for this release slice: A real-title replacement admitted after a child begins a normal bounded teardown does not receive a false capacity `429` before the owned stop contract ends; genuinely stuck teardown stays bounded, retryable, and never oversubscribes the two-slot transcoder. The exact merged revision must pass local and independent checks, exact-head CI/CD, production health, and the strict production first-frame gate. Exact deployed macOS and iPhone Safari proof remains required before the broader active goal can complete.
- Goal/task-contract differences: This narrowly repairs the currently reproduced P0 release blocker. It does not claim to resolve the broader P1 backlog or replace the required exact-release Safari evidence.

## Classification and scope

- Type: BUG (production capacity admission races during normal session teardown).
- In scope:
  - One shared internal teardown-admission bound aligned with the existing explicit-stop behavior.
  - Accurate bounded `Retry-After` semantics without releasing capacity before child `close`.
  - Focused regressions for explicit-stop and abandoned-session reclamation around the old two-second boundary, plus the over-bound negative case.
  - Playback-test diagnostics that surface media `4xx` responses directly while retaining the strict first-attempt decoded-frame assertion.
- Out of scope:
  - Increasing transcoder capacity, weakening startup assertions, bypassing server-side access controls, changing provider credentials, or using demo media.
  - Railway configuration/deployment writes, destructive data or infrastructure actions, Apple adaptive-streaming redesign, and unrelated P1 remediation.
- Assumptions:
  - `2,500 ms` is the authoritative internal stop budget because the existing explicit `/stop` endpoint already applies it; the browser and route relay retain their outer three-second deadlines to allow response propagation.
  - A conservative `Retry-After: 3` accurately communicates the rounded bounded wait to normal clients.

## Baseline evidence

- User/client path: the exact merge's single-worker production suite navigates between live catalog playback sessions. `afterEach(page.goto('/'))` sends best-effort session cleanup; the next laptop Shrek bootstrap request is a normal successor, not a parallel test.
- Expected: The successor waits for an already-stopping child to fully close within the owned stop interval, starts as source attempt `1`, reaches a decoded frame, and advances continuously.
- Actual: The exact production workflow for merge `3034a398706f72d552b68a6c9cf134218964649e` failed its strict laptop test because the first decoded frame was reported on attempt `2`. Sanitized production logs recorded `Stream compatible video failed 429 in 2002–2005ms` three times. This matches `CAPACITY_RECLAIM_WAIT_MS = 2,000` while `waitForStoppedJob()` permits `2,500ms`; `stoppingJobs` correctly retains closing children as occupied but the admission path exits too early.
- Root cause: A legitimate child close that falls in the 500ms gap between admission's two-second wait and the owned 2.5-second stop contract is falsely classified as sustained full capacity. The player correctly falls back and increments source attempt, so the strict test exposes rather than causes the defect.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|
| AC-1 | An explicit-stop successor whose original child closes after the former two-second admission ceiling but before the shared stop bound is admitted without a `429`, and active capacity never exceeds its configured limit. | New focused transcoder lifecycle regression, first RED then GREEN. | local evidence complete; exact production pending |
| AC-2 | The same near-bound close succeeds when capacity is reclaimed from an abandoned playback session, not only from an explicit stop. | New focused transcoder lifecycle regression. | local evidence complete; exact production pending |
| AC-3 | A child that remains open beyond the shared stop bound returns a bounded `429` with `Retry-After: 3`, retains the occupied stopping slot, and permits a later successor after close. | Existing timeout regression strengthened for timing/header/health behavior. | local evidence complete; exact production pending |
| AC-4 | The real-title production playback test still requires a first decoded frame on source attempt `1` and reports relevant media `4xx` details rather than masking them as generic readiness failure. | Focused UI test update and production playback artifact. | local test parsing complete; exact production pending |
| AC-5 | The candidate passes focused tests, full unit suite, lint, build, browser smoke/WebKit checks, independent clean-context verification, exact-head CI, exact main CI/CD, production health, and the production real-title playback suite. | Command logs, PR checks, deployed commit, health response, and CI artifacts. | local and independent evidence complete; PR/CI/deployment pending |
| AC-6 | The exact deployed revision is measured with a real live-catalog title on laptop Safari and iPhone Safari/device simulator: first decoded frame and continuously advancing media time. | Authorized browser/device evidence. | blocked pending explicit authorization to enter the server-side access code in those browsers |

## Risk and release

- Security/privacy/data risks: No provider or access credential is read, logged, copied, committed, or entered into a browser without separate explicit consent. Diagnostics contain only route templates, status, timing, and test metadata.
- Compatibility/performance/accessibility risks: The shared timeout must leave browser and server relay response headroom, avoid capacity oversubscription, preserve normal cancellation, and not loosen the first-frame quality gate.
- Rollout: Canonical branch → GDemay pull request → exact-head green CI → merge through PR → automatic Railway deployment. Railway status/log reads use only the approved MCP and exact resource IDs; no Railway write is part of this slice.
- Health signals and thresholds: public `/api/health` reports the exact merge commit and healthy dependencies; production logs show no unexpected compatible-video capacity `429` during the strict playback suite; real-title playback reports attempt `1`, first decoded frame within the existing suite threshold, and monotonic continuous time samples.
- Rollback/disable path: If the exact release regresses capacity, revert via a canonical PR. Do not use destructive infrastructure actions or a direct deployment rollback without separate authorization.

## Verification log

- 2026-08-30, baseline: canonical fetch/push remote, GDemay commit identity, hook path, and repository-scoped SSH command were verified. The root checkout contains user-owned unresolved edits and remains untouched. A clean worktree was created from exact `origin/main` merge `3034a398706f72d552b68a6c9cf134218964649e`.
- 2026-08-30, reproduced production defect: exact main CI run `33297247327` passed validation but failed the live playback gate: laptop first-frame telemetry was attempt `2`. Railway application logs for the exact deployment independently show compatible-video `429` responses after approximately 2.003 seconds.
- 2026-08-30, independent timing review: clean-context analysis traced the mismatch between the 2.0-second admission wait and 2.5-second explicit-stop contract, while preserving the child-`close` invariant as necessary to prevent oversubscription.
- 2026-08-30, RED regression: the new explicit-stop successor fixture deliberately retained an inherited media pipe for 2.2 seconds after its encoder parent stopped. On the untouched baseline, `npx vitest run scripts/transcoder-bootstrap.test.ts --testNamePattern='waits through the full explicit-stop contract'` failed with `expected 429 to be 200`, reproducing the exact production failure class without provider access.
- 2026-08-30, RED descendant regression: the owned-process-group fixture proved that a direct child signal allowed a same-group inherited-pipe descendant to write after its encoder stop. This is a resource/capacity leak, not a readiness-only test artifact.
- 2026-08-30, local GREEN: capacity-managed HLS and compatible encoders now start in an owned POSIX process group, teardown signals that group with a Windows direct-child fallback, and capacity remains `close`-based. A single `PLAYBACK_STOP_WAIT_MS=2,500` now governs explicit stop, active teardown admission, and abandoned-session reclamation; `Retry-After` is conservatively rounded to `3`. Safe health counters and sanitized logs distinguish reclaimed/stopping waits and timeout reasons.
- 2026-08-30, local quality gate: lifecycle suite passed `21/21`; full units passed `53` files / `359` tests; lint and production build passed; deterministic browser smoke passed `98` tests with `19` intentional platform skips; WebKit keyboard/focus passed `5/5`. The production playback specification parses with the retained strict attempt-one assertion and now captures any playback media `4xx` by method and route path. Independent review, PR/CI, exact deployment, and real-title production/Safari verification remain pending.
- 2026-08-30, independent clean-context verification: the first review correctly caught a transient-state assertion that could miss an immediate process-group close. The regression was repaired to assert the durable contract instead: completed stop, no surviving owned descendant, admitted successor, `inUse: 2`, and `stopping: 0`. A fresh recheck passed the explicit-stop, abandoned-reclaim, escaped-over-bound, POSIX group, and fixed-profile HLS cases; lint, JavaScript syntax, and whitespace checks passed. The reviewer found no local blocker and correctly left production, CI/CD, and Safari evidence unverified.
- 2026-08-30, CI repair: PR validation for commit `5e46a4e0` correctly failed before deployment when an older queued-startup fixture expected a regular descendant to remain in `stoppingJobs`. The POSIX process-group fix correctly terminated it first on Linux. Both queued-startup tests now create an explicit escaped inherited-pipe helper when their acceptance path requires a genuinely occupied teardown slot; their cancellation assertions remain unchanged. Focused queue tests and a fresh full unit suite passed locally; updated PR CI is required.
