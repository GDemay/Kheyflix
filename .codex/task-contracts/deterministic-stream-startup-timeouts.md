# Task contract: Deterministic stream-startup timeout regressions

## Goal alignment

- Active goal objective: Deliver a production-ready, Netflix-quality Kheyflix: establish a measured baseline; eliminate P0/P1 streaming, reliability, performance, security, and product-experience issues; add regression coverage and observability; and safely deliver every change through the required GDemay/Kheyflix PR, CI/CD, production-health, and real laptop/iPhone Safari playback verification workflow.
- Authoritative inputs: the user’s quality mandate; `AGENTS.md`; `.github/workflows/ci.yml`; the exact failed `main` CI run `33319787650`; `app/api/debrid/stream/[id]/[file]/route.ts`; and its unit regression suite.
- Baseline revision: canonical `origin/main` merge `faf2df229f817cd6b94f48de78aaf24bdc319718`, isolated on `originator/startup-timer-determinism` after confirming the SSH remote, commit identity, hooks, and local secret-file protections.
- Verifiable stopping condition: every intentionally stalled stream-startup regression drives its configured timeout through a controlled clock only after the relevant request stage begins, while preserving the public error, abort, retry, DNS, and provider-call assertions. The exact merged revision must then pass all local and independent checks, exact-head CI, exact-main CI/CD, health, and real-catalog release verification.
- Goal/task-contract differences: this is a bounded P1 test-reliability repair. It does not alter production streaming behavior, provider credentials, access controls, Railway configuration, or the broader manual Safari/iPhone evidence requirement.

## Classification and scope

- Type: BUG (nondeterministic regression-test scheduling).
- In scope:
  - Replace real 250/500 ms waits in stalled startup-path tests with explicit fake-clock advancement and stage-start gates.
  - Preserve the production-minimum timeout values and all existing behavior assertions.
  - Add focused coverage for the shared startup budget so a stale-link recovery cannot reset it.
  - Run the project’s local gates, independent review, PR/CI, merge, exact deployment, health, and production real-title checks.
- Out of scope:
  - Changing `route.ts` production behavior, timeout values, credentials, access sessions, deployment settings, or test expectations to mask a failure.
  - Demo/open-media playback or browser credential transfer.
- Assumptions:
  - A deterministic controlled-clock test is stronger evidence than relying on process scheduling to fire a 250 ms deadline.
  - Existing fake-clock coverage for initial AllDebrid resolution is the local pattern to preserve.

## Baseline evidence

- User/client path: the stream route enforces one absolute startup budget across resolution, DNS, provider first byte, and one safe recovery. Its regressions deliberately stall those stages at the production-minimum 250 ms deadline.
- Expected: the suite completes deterministically and verifies the same externally observable timeout/retry/cancellation behavior on developer machines and in parallel CI.
- Actual: exact `main` CI run `33319787650` failed at `app/api/debrid/stream/[id]/[file]/route.test.ts:239` after 5,000 ms in `does not reset the startup budget while a stale link is being recovered`; 404 of 405 tests passed. The test waited for real 250/500 ms callbacks, which can be starved by a CPU-heavy parallel Vitest worker. The pre-merge exact-head run passed, confirming a scheduler-dependent test failure rather than a production behavior regression.
- Evidence: the failed canonical workflow logs identify the sole timed-out test; review of the suite found the same real-timer pattern in stalled DNS, provider-response, first-byte, recovery, and unsafe-refresh regressions. The initial-resolution regression already uses a fake clock and deterministic start gate.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|
| AC-1 | Each deliberately stalled 250/500 ms startup test advances a fake clock only after the operation it intends to bound has started. | Focused route suite; source review of all stalled timeout cases. | local + independent pass |
| AC-2 | The stale-link regression proves the first attempt expires at 250 ms, refresh starts, and the original 500 ms absolute budget expires without resetting. | Focused route test asserting `504`, forwarded/aborted refresh signal, one provider fetch, and exactly two resolutions. | local + independent pass |
| AC-3 | Existing direct DNS, provider DNS, provider fetch, first-body-byte, failed-cleanup, retryable-response, and unsafe-refresh assertions retain their existing public outcomes. | Full route suite plus full unit suite. | local + independent pass |
| AC-4 | No production streaming implementation or configured production timeout changes are introduced. | Diff review; independent clean-context verifier. | local + independent pass |
| AC-5 | The exact candidate passes lint, full unit, build, browser smoke/WebKit, PR checks, exact main CI/CD, public health, and real-catalog production suite. | Command logs, CI artifacts, health response, and production verifier. | local pass; PR/CI/deployment pending |
| AC-6 | The exact deployed revision has direct authenticated macOS Safari and iPhone Safari/device-simulator evidence of a real catalog title’s first decoded frame and continuously advancing media time. | Authorized manual browser/device evidence. | blocked pending an authorized Safari session |

## Risk and release

- Security/privacy/data risks: do not read, print, copy, commit, or expose `.env.local`, provider URLs, access codes, session values, or credentials. Tests use local fakes only and no demo media.
- Compatibility/performance/accessibility risks: test clocks must not leak across tests or mask real deadline behavior; `finally { vi.useRealTimers() }` is mandatory for each fake-clock test.
- Rollout: canonical branch → canonical GDemay PR → green exact-head CI → merge through PR → exact-main CI/CD → Railway MCP read-only deployment status → public health and real-catalog verification. No Railway write is authorized by this repair.
- Health signals and thresholds: zero test timeout failures; all validation checks green for the exact commit; production health reports the exact commit and healthy required dependencies; no production playback regression in the real-title suite.
- Rollback/disable path: if the release regresses behavior, revert through a canonical PR. No destructive Railway rollback is authorized.

## Verification log

- 2026-08-30, baseline: `origin` fetch/push both resolve to `git@github.com:GDemay/Kheyflix.git`; repository SSH, hooks, and future commit identity were confirmed. The branch is clean and based on exact `origin/main` merge `faf2df229f817cd6b94f48de78aaf24bdc319718`.
- 2026-08-30, reproduced: canonical main CI run `33319787650` failed only at the stale-link startup-budget regression after Vitest’s 5-second test ceiling. The affected code uses real 250/500 ms timers, so parallel scheduling can consume its assertion window before its staged provider work runs.
- 2026-08-30, plan: retain every public assertion and replace only test scheduling with fake timers plus explicit operation-start gates. The candidate has not yet changed production code.
- 2026-08-30, GREEN focused gate: the complete stream route suite passed 51/51 in 479 ms (74 ms test execution). The previous baseline’s isolated stale-link check took 520 ms because it waited for real timers. Every intentional stall now waits for a resolver/fetch/body-read/cleanup stage gate before advancing exactly 250 ms; the stale-link path advances 250 ms to begin refresh, then the remaining 250 ms of its single 500 ms budget.
- 2026-08-30, local quality gate: `npm run lint` passed; `npm test` passed 54 files / 405 tests in 105.40 s; `npm run build` passed; `npm run test:ui:smoke` passed 131 with 19 platform-gated skips in 3.9 m; and `npm run test:ui:webkit` passed 12/12. The expected local mocked media-error/provider-failure diagnostics exercised their recovery/error contracts and did not fail tests.
- 2026-08-30, independent clean-context acceptance review: AC-1 through AC-4 passed. The reviewer confirmed ten guarded fake-clock cases with ten `finally` timer restorations, retained public error/retry/abort assertions, no production route diff, and a clean whitespace check. It ran the focused suite 51/51 in 424 ms and repeated the isolated stale-link regression 20 consecutive times without failure. AC-5 correctly remains pending canonical PR/CI/CD and production evidence.
- 2026-08-30, final candidate check: after the last cleanup-stage gate refinement, `npm run lint`, `git diff --check`, and the full unit suite passed again; `npm test` reported 54 files / 405 tests in 104.26 s. The existing build and browser gates remain valid because the production application source is unchanged; the canonical PR will rerun every required gate on the exact candidate.
