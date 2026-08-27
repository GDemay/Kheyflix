# Task contract: Restore Star Wars movie discovery

## Goal alignment
- Active goal objective: Restore the normal movie-discovery path so `Star wars` yields appropriate playable movie choices from connected production sources, then deliver and verify the exact revision through production.
- Authoritative inputs: User request and screenshot; repository `AGENTS.md`; `README.md`; `docs/deployment.md`; `docs/observability.md`; discovery implementation, tests, CI/CD; synchronized `origin/main` revision `bce33174994fd0f49ee67be024016256b1fb1af3`.
- Verifiable stopping condition: The merged revision is green in local, independent, PR, and exact-merge CI; production health reports that revision with required dependencies healthy; production `Star wars` movie discovery returns compatible movie choices; a real returned title decodes and continuously advances on laptop and iPhone Safari/simulator.
- Goal/task-contract differences: none.

## Classification and scope
- Type: BUG.
- In scope: Recover movie results when an indexer does not map releases into Prowlarr's movie category, while preserving local kind and compatibility filtering.
- Out of scope: Adding indexers, accepting games/series as movies, relaxing codec/container compatibility, changing playback, changing secrets or Railway infrastructure.
- Assumptions: A release labeled `other` may be considered a movie fallback only when it has compatible video metadata and its parsed title/year resolve through Kheyflix's existing credential-free TMDB movie-only lookup. The fallback is used only when the provider's scoped movie query returns no usable releases; inability to validate safely yields no fallback result.

## Baseline evidence
- Revision/environment: Production `/api/health`, commit `bce33174994fd0f49ee67be024016256b1fb1af3`, 2026-08-27.
- User or client path: Discovery Movies, query `Star wars`; public `GET /api/discovery/search?q=Star%20wars&kind=movie`.
- Expected: At least one appropriate compatible Star Wars movie choice when connected sources contain one.
- Actual/missing: HTTP 200 with zero results. The unscoped public search returns 25 releases: 18 labeled `other`, including year-bearing films, and 7 labeled `series`; the scoped provider path therefore hides valid movie candidates.
- Evidence: User screenshot plus sanitized public API reproduction (status, counts, category distribution, and exact deployed commit; no magnet/provider URL/secret output).

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A movie search retries without provider category scope when the scoped query yields no usable results and returns year-bearing, non-episodic movie candidates. | Focused `app/lib/prowlarr.test.ts` regression; production `Star wars` query. | local + independent pass; production pending |
| AC-2 | The fallback still excludes series, games/non-video releases, and explicitly incompatible codecs/containers. | Focused unit negative cases and existing suite. | local + independent pass |
| AC-3 | Existing series scoping and successful scoped movie search behavior remain unchanged; fallback does not run when scoped results exist. | Existing and new request-count/query assertions. | local + independent pass |
| AC-4 | Discovery remains accessible and the normal Movies UI shows results rather than the empty state for `Star wars`. | Playwright user-path verification and clean-context verifier. | local UI 12/12 pass; production pending |
| AC-5 | Exact merged production revision is healthy and a real discovered movie decodes a first frame and advances continuously on laptop and iPhone Safari/simulator. | Main CI/CD, `/api/health`, production verifier, real playback suite/device evidence. | pending |

## Risk and release
- Security/privacy/data risks: Provider credentials, magnets, and unlocked URLs remain server-only and absent from evidence/artifacts.
- Compatibility/performance/accessibility risks: An empty scoped movie search may cause one additional provider request. Bounded semantic filtering prevents series/non-video leakage; no UI structure changes are planned.
- Rollout: Canonical branch and PR to `main`; automatic Railway production deployment only after green PR CI.
- Health signals and thresholds: Exact commit; HTTP health success; AllDebrid, discovery, and transcoder healthy; movie discovery non-empty; decoded playback continuously advancing on both required clients.
- Rollback/disable path: Revert through a new canonical PR if a harmful discovery regression is proven; no destructive Railway action is authorized.

## Verification log
- 2026-08-27, `bce33174994fd0f49ee67be024016256b1fb1af3`, production health and sanitized discovery API: exact deployed baseline; required discovery dependencies healthy; scoped movie count 0; unscoped count 25 (18 other, 7 series). BUG reproduced.
- 2026-08-27, working tree, focused Vitest: expected RED (`[]` instead of the compatible film), then GREEN (9/9) after the bounded fallback.
- 2026-08-27, working tree, `npm test && npm run lint && npm run build`: 196/196 tests pass, lint passes, production build passes. Existing dependency audit reports 11 known vulnerabilities (1 low, 10 high); no dependency changes are in scope.
- 2026-08-27, local live-provider path: application starts normally, but configured provider is unreachable from the host and returns sanitized `PROWLARR_ERROR` 502; deterministic provider-boundary coverage remains green. Railway MCP authenticated as Guillaume Demay (`gdemay`) for authorized environment inspection.
- 2026-08-27, working tree, Playwright `tests/ui/discovery-compatibility.spec.ts` on phone and laptop: 12/12 pass. The configured direct Vinext web-server command timed out once; rerunning against the repository's supported `npm run dev` server passed without product changes.
- 2026-08-27, candidate `f4a523b52ced23152b10db770b939a43902f4787`, independent verifier: AC-1/AC-3 pass; AC-2 fail because mislabeled `Other` game/complete-series releases and an uncategorized game could enter the fallback; AC-4/AC-5 unverifiable. Candidate rejected before push.
- 2026-08-27, repair working tree, focused regression: expected RED returned all three unsafe verifier cases, then GREEN 9/9 after requiring explicit fallback eligibility and rejecting game-repack/series-collection markers. Full suite 196/196, lint, and build pass again.
- 2026-08-27, candidate `b2509d4f889838cbe21e6afb1b23771c083b01c0`, independent verifier: prior negatives fixed, but AC-2 still failed for neighboring `Other` game, PC ISO, complete-collection, and soundtrack releases. Candidate rejected before push.
- 2026-08-27, second repair working tree, focused regression: expected RED returned all four neighboring unsafe cases, then GREEN 9/9 after requiring positive compatible video evidence (resolution plus source or H.264) and rejecting parsed season packs. Full suite 196/196, lint, and build pass again.
- 2026-08-27, candidate `6220b8f7e5e2496cf888b3cc739c5c9f60ece82d`, independent verifier: all earlier negatives fixed, but AC-2 still failed for explicit TV-series, all-episodes, gameplay, and video-tagged soundtrack/audio releases. Candidate rejected before push.
- 2026-08-27, resumed repair working tree, focused regression: expected RED returned all four remaining semantic false positives, then GREEN 9/9 after centralized explicit non-movie media rejection. Full suite 196/196, lint, and build pass again.
- 2026-08-27, candidate `cf721fc9e768374e55a60a0ce398aac7ca51f103`, independent verifier: the complete prior corpus was fixed, but AC-2 failed for miniseries, numbered-series, and walkthrough semantics. Candidate rejected before push.
- 2026-08-27, resumed repair 2 working tree, focused regression: expected RED returned all three verifier cases, then GREEN 9/9 after general series-number/miniseries and game-video semantic exclusions. Full suite 196/196, lint, and build pass again.
- 2026-08-27, candidate `ca1b51de168f5ed0abb3b49764451b507c3d6579`, independent verifier: accumulated corpus fixed, but AC-2 failed for limited-series, word-numbered season, and longplay variants. Candidate rejected before push.
- 2026-08-27, resumed repair 3 working tree, focused regression: expected RED returned all three verifier cases, then GREEN 9/9 after general limited-series, word/Roman season, and game-video longplay exclusions. Full suite 196/196, lint, and build pass again.
- 2026-08-27, user resumed blocked goal with explicit direction to fix it. Replaced the title-token classifier with authoritative candidate title/year validation through TMDB's movie-only website search. Structural regression first failed on `Series One` and `Full Game`, then passes 9/9 while preserving the full accumulated negative corpus.
- 2026-08-27, live-source replay through the authoritative boundary: 25 unscoped production releases, 6 compatibility candidates, 5 verified movies (Episode I, Rogue One, Episodes IV/VI, and The Mandalorian and Grogu), with no secrets, magnets, or provider URLs emitted. Full suite 196/196, lint, and build pass.
- 2026-08-27, candidate `b7c13a1047cfaf9b3c833ba1bbcebc42adc49053`, independent verifier: authoritative strategy works live but AC-2 failed loose substring matching; reliability findings were 30 concurrent/unmemoized lookups and silent TMDB failure. Candidate rejected before push.
- 2026-08-27, authoritative reliability repair: three tests first failed for generic-title soundtrack validation, 14 unbounded/duplicate requests, and silent HTTP 503; then pass 11/11 after alias-aware exact matching, 12 unique-candidate cap with concurrency 3, and explicit `MOVIE_VALIDATION_UNAVAILABLE` 502. Full suite 198/198, lint, build, and phone/laptop discovery UI 12/12 pass.
- 2026-08-27, candidate `e2d8a832279815772af5d69e87f6a6f3353a2595`, independent verifier: operational bounds passed, but AC-2 failed because the Episode-prefix alias rule admitted an Episode-IV soundtrack and rejected the common A-New-Hope form. Candidate rejected before push.
- 2026-08-27, authoritative alias repair: confirmed TMDB movie 11's `/titles` page exposes exact “Episode IV – A New Hope” and “A New Hope” aliases. Regression first failed the A-New-Hope form, then passes 12/12 after exact normalized canonical/alternate-title matching; both generic and Episode-IV soundtrack variants are rejected. Full suite 199/199, lint, and build pass.
- 2026-08-27, candidate `dbb58ec87bd020626d83465d13aee2676fe54ef1`, independent verifier: AC-2 passed and all alias/soundtrack cases were correct; operational gate failed because 12 searches plus 12 alias requests exceeded the 12-total-request budget. Candidate rejected before push.
- 2026-08-27, total-request repair: worst-case regression first observed 24 TMDB requests, then passes with six unique compatibility candidates, at most six searches plus six exact-alias lookups, concurrency 3, and per-movie-path alias memoization. The live Star Wars set contains six compatibility candidates, so all remain eligible for validation. Full suite 199/199, lint, and build pass.
- 2026-08-27, candidate `d97b40da98706bda6045ee3d36d47ac2b1749cce`, independent verifier: AC-2 passed, but a search returning two same-year identities produced 18 total TMDB requests. Candidate rejected before push.
- 2026-08-27, shared-budget repair: worst-case two-identity regression first observed 18 requests, then passes with one decrementing 12-request budget shared by six search requests and all unique alias pages. Full suite 199/199, lint, and build pass.
- 2026-08-27, candidate `212adadaab0bbc929075858ad462548bf87ea0d7`, independent verifier: AC-1/AC-2/AC-3 pass; 12 total requests, 6 searches, concurrency 3, search/alias memoization, outage 502, and privacy gates pass; no actionable local defect. AC-4 separately proven by 12/12 phone/laptop Playwright. AC-5 remains release-gated.
