# Task contract: Find and prepare the next missing series episode

## Goal alignment
- Active goal objective: Deliver a production-ready “download next missing episode” experience for partially available series through the existing authorized discovery and preparation path.
- Authoritative inputs: User request and screenshot; `/Users/gdemay/Documents/Projects/Kheyflix/AGENTS.md`; `README.md`; `docs/deployment.md`; `docs/observability.md`; synchronized `origin/main` revision `582674c92c3c98270b680efb15c7e4e75e8053a1`; current series detail, metadata, discovery, Prowlarr, AllDebrid, routing, UI tests, and CI contracts.
- Verifiable stopping condition: The exact merged production revision lets a normal user find the earliest metadata-known episode missing from a partial series, search for that episode without re-entering its coordinates, explicitly authorize and prepare a release through the existing server APIs, recover from errors/no results, and return to the refreshed series; all local, independent, CI, deployment, health, catalog, and required playback evidence is green.
- Goal/task-contract differences: none.

## Classification and scope
- Type: FEATURE
- In scope: Determine the earliest missing episode in provider metadata; add an accessible contextual series-detail action; carry title/season/episode/return context into Discover; automatically run the scoped search; retain explicit rights confirmation; prepare and poll with existing APIs; offer a return to the originating series once ready; responsive laptop/phone UX; unit and user-path regression coverage.
- Out of scope: Automatic unattended acquisition, selecting a release without the user, bulk season downloads, guessing beyond available metadata, changing providers or Railway configuration, unrelated catalog/playback changes, demo/open-movie evidence.
- Assumptions: “next serie” means the next missing episode. “Download” means prepare in the user’s AllDebrid-backed Kheyflix library. If metadata cannot prove that an episode is missing, no acquisition prompt is shown. The earliest chronological metadata episode absent from the library is “next,” including a gap before the highest available episode.

## Baseline evidence
- Revision/environment: `582674c92c3c98270b680efb15c7e4e75e8053a1`, isolated local worktree.
- User or client path: Open a partially available series detail such as Friends and inspect Episodes; separately open Discover.
- Expected: A contextual action identifies and searches for the next missing episode, then returns to the series after preparation.
- Actual/missing: Series detail lists only ready episodes and has no missing-episode action. Discover supports manual series/season/episode entry and preparation but receives no context from series detail.
- Evidence: `app/debrid-library.tsx` series detail renders only `item.episodes`; `app/discovery-page.tsx` initializes an empty movie search; baseline screenshot supplied by the user shows only Play, Like, season selection, and existing episode rows.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A partial series with provider episode metadata shows the earliest missing episode as an accessible “Find SxxExx” action; a complete or metadata-unknown series does not. | Unit tests plus series-detail Playwright path. | local pass |
| AC-2 | Activating the action opens Discover in Series mode with title, season, and episode prefilled and automatically searches the exact coordinates. | Routing/unit tests and Playwright request assertion. | local pass |
| AC-3 | The user must still explicitly confirm authorization before Prepare is enabled; preparation uses the existing magnet endpoint and communicates progress/errors accessibly. | Existing discovery tests plus contextual Playwright path. | local pass |
| AC-4 | When preparation is ready, the UX offers a clear return to the originating series and the refreshed detail exposes the newly available episode. | Contextual Playwright path with mocked catalog refresh. | local pass |
| AC-5 | No-result and failed search/preparation states remain understandable and retryable without losing the contextual target. | Contextual Playwright negative paths. | local pass |
| AC-6 | The flow has no serious/critical automated accessibility violations and no horizontal overflow on supported phone and laptop viewports. | Axe and geometry assertions. | local pass |
| AC-7 | Existing discovery, catalog, playback, secrets, and observability contracts remain green. | Full test, lint, build, applicable UI/playback and production checks. | local pass; CI/production pending |

## Risk and release
- Security/privacy/data risks: Magnet preparation remains server-side and requires the existing explicit rights confirmation. No query contains secrets or magnet URIs. Logs must not include search terms, release names, magnets, provider URLs, or credentials.
- Compatibility/performance/accessibility risks: Metadata may be delayed/unavailable; no prompt appears until proven. Context URL values are bounded by existing route parsing and browser URL handling. Controls require names, keyboard access, live progress, touch targets, and responsive layout.
- Rollout: Standard PR to canonical `main`; automatic GitHub-backed Railway production deployment after green PR checks.
- Health signals and thresholds: Exact commit on `/api/health`; required dependencies healthy; production verifier green; no serious/critical accessibility failures; no horizontal overflow; real-catalog playback produces a first decoded frame and continuously advances on laptop and iPhone Safari as required by repository policy.
- Rollback/disable path: Revert the merge through a new canonical PR if production acceptance or health regresses. Do not use destructive Railway controls without explicit confirmation.

## Verification log
- 2026-08-27, baseline `582674c`, code and supplied screenshot inspection: contextual next-episode acquisition is absent while manual Discover preparation exists.
- 2026-08-27, RED, `npm test -- --run app/lib/episode-acquisition.test.ts`: failed because the missing-episode module did not exist.
- 2026-08-27, RED, `npm test -- --run app/routing.test.ts`: contextual Discover route collapsed to `/discover`.
- 2026-08-27, RED, laptop Playwright user path: Friends detail did not expose the metadata-known missing episode or a Find action.
- 2026-08-27, GREEN, focused unit/routing tests: 7 passed.
- 2026-08-27, GREEN, contextual plus existing discovery UI on phone/laptop: 14 passed; accessibility and horizontal overflow assertions passed.
- 2026-08-27, local quality, `npm test && npm run lint && npm run build`: 192 tests passed, lint clean, production build succeeded.
- 2026-08-27, full UI attempt against `vinext start`: real local provider/transcode paths returned upstream 502 `fetch failed`; deterministic feature/discovery tests remained green. Exact production playback control subsequently passed 6 tests (2 project-inapplicable skips), with first decoded frames at 1.334s phone and 0.851s laptop and continuous advancement.
- 2026-08-27, independent clean-context verification: AC-1 through AC-6 PASS on phone and laptop; AC-7 local evidence PASS with merge/CI/deployment portions pending. Verifier reran 7 focused tests, all 192 unit tests, lint, build, 2 contextual UI paths, 12 discovery negative/regression paths, axe, overflow, and `git diff --check` without editing files.
