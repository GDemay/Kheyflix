# Task contract: Find and prepare the next missing series season

## Goal alignment
- Active goal objective: Correct the shipped acquisition experience so it finds and prepares the next missing complete season, not an individual episode.
- Authoritative inputs: User correction and screenshot; `/Users/gdemay/Documents/Projects/Kheyflix/AGENTS.md`; repository docs and contracts; synchronized `origin/main` revision `bf00c053`; the shipped next-episode implementation from PR #60.
- Verifiable stopping condition: The exact merged production revision lets a normal user with Seasons 1 and 2 find Season 3, opens Discover with Episode set to Any, prepares a complete-season release through the existing authorized path, and returns to a refreshed series containing Season 3; all local, CI, deployment, health, catalog, and required playback evidence is green.
- Goal/task-contract differences: This contract supersedes the user-rejected episode interpretation delivered by PR #60.

## Classification and scope
- Type: FEATURE
- In scope: Determine the earliest metadata-known season wholly absent from the library; expose an accessible Find Season action; carry title/season/return context into Discover without an episode constraint; automatically run the scoped season search; retain authorization, preparation, polling, return, responsive, and accessibility behavior.
- Out of scope: Individual missing-episode acquisition, automatic unattended acquisition, selecting a release without the user, guessing beyond metadata, provider/Railway changes, unrelated catalog/playback changes, or demo playback evidence.
- Assumptions: “Download” means prepare in the user’s AllDebrid-backed library. A season counts as present when at least one episode from it exists; holes inside that season do not trigger the season action. The earliest metadata season with no library episodes is next.

## Baseline evidence
- Revision/environment: `bf00c053`, isolated local worktree.
- User or client path: Open a partially available series detail such as Friends and inspect Episodes; separately open Discover.
- Expected: Friends with Seasons 1 and 2 offers Find Season 3 and searches for a complete Season 3 with Episode Any.
- Actual/missing: The shipped flow offers an individual episode such as S01E02 and adds an episode parameter, contrary to the correction screenshot.
- Evidence: User screenshot and the PR #60 code/test contract.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A series with Seasons 1 and 2 and metadata for Season 3 shows an accessible “Find Season 3”; missing episodes inside an owned season do not trigger it. | Unit tests plus series-detail Playwright path. | local pass |
| AC-2 | Activating the action opens Discover in Series mode with title and Season 3 prefilled, Episode Any, and no episode query parameter. | Routing/unit tests and Playwright request assertion. | local pass |
| AC-3 | The user must still explicitly confirm authorization before Prepare is enabled; preparation uses the existing magnet endpoint and communicates progress/errors accessibly. | Existing discovery tests plus contextual Playwright path. | local pass |
| AC-4 | When a complete-season preparation is ready, returning to the refreshed series exposes the newly available season and its episodes. | Contextual Playwright path with mocked catalog refresh. | local pass |
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
- 2026-08-27, baseline `bf00c053`, user correction and screenshot: shipped behavior targets an episode instead of the next missing season.
- 2026-08-27, RED, `npm test -- --run app/lib/season-acquisition.test.ts app/routing.test.ts`: failed because no season acquisition module existed.
- 2026-08-27, GREEN, focused unit/routing tests: 8 passed.
- 2026-08-27, GREEN, corrected contextual UI on phone and laptop: 2 passed; Season 3 searched with Episode Any, complete-season preparation returned a three-season library, axe and overflow checks passed.
- 2026-08-27, local quality, `npm test && npm run lint && npm run build && git diff --check`: 195 tests passed, lint clean, production build succeeded, diff check clean.
