# Task contract: Recover new-movie playback from transient preflight failure

## Classification and scope
- Type: BUG
- In scope: Playback entered from Discovery for a newly prepared movie; transient browser transport failures during the provider `HEAD` preflight.
- Out of scope: Discovery search quality, magnet preparation, permanent provider/API failures, and media compatibility changes.
- Assumptions: A rejected same-origin preflight fetch is not authoritative evidence that the media element's subsequent request will fail; an explicit non-success HTTP response remains authoritative.

## Baseline evidence
- Revision/environment: `09841ce465435806887a80aa457b947c9fffb3c7`, local Vinext development server, 2026-08-23.
- User or client path: Prepare previously unseen “Pride & Prejudice” (2005), then select Watch for magnet `514397162`, file `2`.
- Expected: Playback proceeds to the media request and either starts or reports an authoritative provider/media error.
- Actual/missing: The browser recorded `TypeError: Failed to fetch` in the provider preflight and immediately rendered fatal playback failure; a simultaneous Vinext RSC navigation transport error was also recorded.
- Evidence: User-supplied sanitized console trace. On the same baseline and exact stream selection, `HEAD /api/debrid/stream/514397162/2` returned 200 and the visible player reached its loading/playback UI, demonstrating the transport rejection can be transient.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A network-level preflight rejection does not prevent the player from issuing its normal media request. | Focused policy regression test plus visible player playback path. | independently verified |
| AC-2 | An explicit non-success provider HTTP response still produces a useful fatal error. | Focused policy regression test. | independently verified |
| AC-3 | Aborted preflights caused by unmount/navigation remain ignored. | Focused policy regression test. | independently verified |
| AC-4 | Existing test, lint, and production-build gates remain green. | Repository quality commands. | independently verified |

## Risk and release
- Security/privacy/data risks: No credentials or provider URLs may enter browser code, logs, tests, or commits.
- Compatibility/performance/accessibility risks: One failed `HEAD` may be followed by the already-intended media request; the existing accessible playback error remains unchanged for authoritative failures.
- Rollout: Focused client-only behavior change through the normal pull-request and CI path.
- Health signals and thresholds: No new playback console errors on a successful stream; all repository checks green; public health endpoint remains healthy after deployment if deployment is authorized and available.
- Rollback/disable path: Revert the focused commit/PR.

## Verification log
- 2026-08-23, baseline `09841ce4`: user trace reproduced the fatal classification of `TypeError: Failed to fetch`; exact public stream `HEAD` returned HTTP 200 and visible player route did not show a fatal error on retry.
- 2026-08-23, candidate working tree: focused regression test passed (3/3); exact stream route reached media `readyState=4`, then advanced from 0 to 2.46 seconds after the visible Play control was selected, with no media or console error through `http://localhost:3002`.
- 2026-08-23, candidate working tree: full Vitest suite passed (21 files, 115 tests), ESLint passed, and Vinext production build passed (existing chunk-size advisory only).
- 2026-08-23, independent verifier: PASS AC-1 through AC-4; public playback advanced beyond 5.5 seconds with no media error, alert, warning, or error; negative-path policy tests and all quality gates passed.
