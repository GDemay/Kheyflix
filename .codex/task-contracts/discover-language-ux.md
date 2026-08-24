# Task contract: Discover language metadata and filter clarity

## Classification and scope
- Type: MIXED (language-detection bug and discover-results UX feature)
- In scope: audit the discover search/results workflow; expose audio and subtitle language status on every release; recognize common real-world language tags; make language filters visibly actionable and resettable; preserve movie/series, season, episode, quality, authorization, preparation, and playback behavior; verify representative famous movie and series searches.
- Out of scope: claiming languages that upstream release names do not advertise; inspecting a torrent's files before the user authorizes and prepares it; changing the player track selector; changing providers or indexer configuration.
- Assumptions: search-time language metadata must remain conservative and title-derived. Unknown means “not specified by source,” not “no audio/subtitles.” Famous-title verification uses search only until the existing authorization gate is confirmed.

## Baseline evidence
- Revision/environment: `926e354d3db69bcf240853d9c74583b040ee3ad7`, production and local parser/UI source, 2026-08-24.
- User or client path: Discover → Movies/Series → search a famous title → inspect result cards and the Subtitles filter.
- Expected: every card clearly communicates audio/subtitle metadata status; common advertised languages are detected; filters reveal available choices, affect results, and can be cleared.
- Actual/missing: cards omit both fields when metadata arrays are empty; the Subtitles select often contains only “Any subtitles,” so it appears broken; parser misses common compact/mixed tags such as `Eng Ita` and Nordic subtitle labels.
- Evidence: production API searches: Inception 12 results (2 audio-tagged, 1 subtitle-tagged); Dune Part Two 16 (2, 0); Breaking Bad 25 (1, 1); Game of Thrones 25 (2, 0). Existing parser/UI tests do not require unknown-state disclosure, audio filtering, counts, or clear-filter behavior.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Common advertised audio and subtitle tags in real release naming are parsed into normalized language names without misclassifying subtitle tags as audio. | Focused parser regression tests using observed title patterns. | independent pass |
| AC-2 | Every discover result visibly labels both Audio and Subtitles, using normalized languages or an honest “Not specified” state. | Playwright result-card assertions. | independent pass |
| AC-3 | Audio and subtitle filters show available language choices with result counts, filter the result list, and expose a clear-all action when active. | Playwright interaction test including a no-match/clear path. | independent pass |
| AC-4 | A filter with no advertised language metadata is visibly disabled/explained rather than appearing interactive but inert. | Playwright negative-path assertion. | independent pass |
| AC-5 | The revised section is responsive, keyboard accessible, and free of serious/critical automated accessibility violations on supported phone and laptop viewports. | Responsive Playwright and axe checks plus browser inspection. | independent pass |
| AC-6 | Movie/series search, season/episode controls, authorization gating, prepare, and watch behavior remain intact. | Existing unit/UI suites and focused regression checks. | independent pass |
| AC-7 | Production serves the exact merge commit, dependencies are healthy, representative famous-title searches return coherent metadata, and laptop/iPhone playback reaches a decoded first frame and advances continuously on a real live-catalog title. | CI/CD, `/api/health`, production verifier, API samples, and required playback suite. | pending |

## Risk and release
- Security/privacy/data risks: keep provider keys server-only and never log magnets or secrets; no pre-authorization content preparation.
- Compatibility/performance/accessibility risks: title parsing false positives; filter layout overflow on phone; disabled-control semantics; screen-reader clarity. Parsing remains conservative and filtering stays client-side over the existing maximum 30 results.
- Rollout: normal pull request to `GDemay/Kheyflix` `main`, automatic Railway production deployment after green PR checks.
- Health signals and thresholds: all required checks green for exact revisions; `/api/health` status `ok` with AllDebrid, transcoder, and discovery healthy; no regression in production playback suite.
- Rollback/disable path: revert the merge through a pull request if language parsing or discover interaction regresses; no migration or persisted-data rollback is required.

## Verification log
- 2026-08-24, `926e354`, production discovery API, reproduced sparse/omitted language status across Inception, Dune Part Two, Breaking Bad, and Game of Thrones; see baseline evidence above.
- 2026-08-24, working tree, parser RED: 2 intended failures for compact audio/subtitle tags; discover UI RED: 2 intended failures for missing explicit status/audio control/disabled explanation.
- 2026-08-24, working tree, focused GREEN: parser 7/7; discover Playwright 6/6 across phone and laptop, including filter behavior, responsive overflow, and axe serious/critical checks.
- 2026-08-24, working tree, quality checks: lint pass; build pass; full unit suite 152/152 pass.
- 2026-08-24, working tree, full UI suite: 44/57 pass. All six new discover tests pass on phone/tablet/laptop. Existing provider/playback cases fail intermittently after decoded frames or upstream bootstrap/preflight delays; existing visual baselines are stale relative to untouched-main content-type controls (actual UI contains Movies/Series, snapshots do not). No safeguard was skipped or rewritten; CI remains the authoritative clean-environment gate.
- 2026-08-24, working tree, browser audit at 375px: no horizontal overflow (`scrollWidth=clientWidth=375`), product workflow and authorization semantics present, phone rendering visually legible.
- 2026-08-24, `22674c8e`, independent verifier: AC-1–AC-4 pass, AC-5 fail because the native subtitle value clipped at phone width, AC-6/AC-7 unverifiable before PR/deployment. Added a failing phone-width assertion (157px actual vs 260px minimum), made both language filters full-width on narrow screens, then reran focused phone/laptop UI checks: 6/6 pass.
- 2026-08-24, `c8124e81`, independent repaired-candidate verification: 6/6 focused UI checks in 7.2s; AC-1–AC-6 pass. Phone subtitle control ≥260px, overflow 0, no serious/critical axe findings, series inputs and authorization/prepare/watch gating confirmed. AC-7 remains pending merge and production.
