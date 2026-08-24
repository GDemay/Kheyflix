# Task contract: Identify Lost correctly

## Classification and scope
- Type: BUG
- In scope: Correct the catalog identity for the live six-season Lost collection when its episode list includes `D.O.C.`.
- Out of scope: Catalog artwork redesign, metadata-provider availability, playback behavior, or unrelated title aliases.
- Assumptions: The user is referring to the live 122-episode Lost card shown with Lost artwork but labeled `The O.C.`.

## Baseline evidence
- Revision/environment: `b339a72b82c0fa2b267acdfaf7e14fc084a9f4f5` on production and synchronized `origin/main`.
- User or client path: Load the production catalog; parse magnet `194747691`, whose files include `Lost S03E18 (D.O.C.) Multi Papaya.mkv`.
- Expected: The card and detail metadata identify the collection as `Lost` (2004).
- Actual/missing: The O.C. override matches the `O.C.` substring inside the episode title `D.O.C.` before the Lost override, producing `The O.C.` (2003).
- Evidence: User screenshot; sanitized production `/api/health` and `/api/debrid/magnets` responses; failing focused parser regression.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | The production-shaped Lost collection is labeled `Lost`, year 2004, and remains a six-season series. | Focused parser test using `D.O.C.` and all six seasons | independent pass |
| AC-2 | A genuine `The.O.C.` release still resolves to `The O.C.`, year 2003. | Negative regression test | independent pass |
| AC-3 | The normal catalog interface displays `Lost`, not `The O.C.`, for the affected live collection. | UI/API verification on candidate and production | independent candidate pass |
| AC-4 | Required dependencies remain healthy and the exact merge commit is deployed. | CI, `/api/health`, deployment verifier | pending |

## Risk and release
- Security/privacy/data risks: No secret or user data changes; production evidence remains sanitized.
- Compatibility/performance/accessibility risks: Low; matcher-only change with positive and negative alias coverage.
- Rollout: Standard PR to `main`, automatic Railway production deployment.
- Health signals and thresholds: Required CI green; production health `ok`; AllDebrid, discovery, and transcoder dependencies healthy; exact merge commit reported.
- Rollback/disable path: Revert the merge through a new pull request if catalog identity regressions appear.

## Verification log
- 2026-08-24, baseline `b339a72b`, production health: `ok`, deployed commit exact; required dependencies healthy, metadata dependency degraded.
- 2026-08-24, live catalog: affected Lost collection includes `Lost S03E18 (D.O.C.) Multi Papaya.mkv`, which reproduces the alias collision.
- 2026-08-24, focused test on baseline behavior: RED, received `The O.C.`/2003 instead of `Lost`/2004 while preserving six seasons.
- 2026-08-24, candidate working tree: focused parser suite GREEN (18/18); full test suite GREEN (145/145); lint GREEN; production build GREEN.
- 2026-08-24, candidate normal UI at `http://localhost:3001`: search for `Lost` returns one `Lost` card with six seasons; genuine `The O.C.` remains separately present.
- 2026-08-24, independent verifier: AC-1 PASS, AC-2 PASS, AC-3 PASS. Normal-user Chrome search showed exactly one `Lost` card with six seasons and a distinct genuine `The O.C.` card with one season; Lost detail exposed seasons 1–6.
