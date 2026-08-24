# Task contract: Reduce CI failure noise

## Classification and scope
- Type: BUG
- In scope: prevent superseded CI runs from continuing after a newer commit or pull-request update replaces them; preserve genuine failure reporting.
- Out of scope: disabling GitHub Actions failure notifications or weakening lint, test, build, deployment, health, or playback gates.
- Assumptions: the reported email burst corresponds to the nine failed CI runs on 2026-08-23.

## Baseline evidence
- Revision/environment: `9a2359d88eedf7b4e0fd973b14615160a2c8ae5f` / GitHub Actions.
- User or client path: merge or update several changes in quick succession and receive a notification for each failed CI workflow.
- Expected: an obsolete run is cancelled once a newer run for the same delivery lane starts; a current sustained failure remains failed and visible.
- Actual/missing: `.github/workflows/ci.yml` has no concurrency policy, so superseded runs continue through production verification.
- Evidence: GitHub Actions shows nine failures on 2026-08-23; all nine passed `Lint, test, and build`, while `Verify Railway production` failed. Fourteen subsequent completed CI runs passed.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A newer run cancels an in-progress older run for the same PR or main delivery lane. | Workflow policy unit test and GitHub Actions run evidence | pass |
| AC-2 | Independent PRs do not cancel one another. | Workflow concurrency key contains workflow plus ref | pass |
| AC-3 | Genuine lint, test, build, production health, and playback failures remain blocking. | Workflow inspection, local quality gates, and CI | pass |

## Risk and release
- Security/privacy/data risks: none; no secret or permission changes.
- Compatibility/performance/accessibility risks: cancellation may stop diagnostics for a superseded revision, but the newer revision is authoritative.
- Rollout: merge through a pull request to `main`.
- Health signals and thresholds: exact PR head CI green; exact merge CI/CD green; production health reports exact merge commit and required dependencies healthy.
- Rollback/disable path: revert the workflow concurrency block through a pull request.

## Verification log
- 2026-08-24, baseline `9a2359d88eedf7b4e0fd973b14615160a2c8ae5f`: nine failed runs found on 2026-08-23; all failed only in production verification; fourteen later completed runs succeeded.
- 2026-08-24, local candidate: focused policy test RED on missing concurrency configuration, then GREEN after implementation.
- 2026-08-24, local candidate: lint passed; 26 test files / 150 tests passed; production build passed.
- 2026-08-24, independent local verification: AC-2 PASS and AC-3 PASS; AC-1 structurally correct but UNVERIFIABLE until exercised in GitHub Actions.
- 2026-08-24, GitHub Actions: same-ref run `32760032272` was cancelled when newer run `32760038154` started; the newer exact-head run passed.
