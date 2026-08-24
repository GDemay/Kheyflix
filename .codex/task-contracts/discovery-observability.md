# Task contract: Reliable discovery preparation and production observability

## Classification and scope
- Type: MIXED (BUG + FEATURE)
- In scope: prevent non-video releases from appearing in movie/series discovery; make preparation and polling failures visible and retryable; add structured, correlated, privacy-safe production logs to every public API route; surface request references to users and browser diagnostics; deliver through the canonical production workflow.
- Out of scope: adding games or other non-video content to Kheyflix, changing provider credentials, replacing the logging destination used by Railway, and unrelated playback/catalog redesign.
- Assumptions: “Pokémon” means a playable movie or series title. The FitGirl results in the supplied screenshot are game releases and must not be offered as movies.

## Baseline evidence
- Revision/environment: synchronized `origin/main` at `c17aa109bba568e99ce947ca4a158b32f5dd2a48`; user production screenshot dated 2026-08-24.
- User or client path: Discover → Movies → search `Pokemon` → confirm authorization → prepare a FitGirl result.
- Expected: discovery shows only video-category releases; preparation either reaches a playable state or clearly reports a correlated failure; operators can trace the complete API request in production logs.
- Actual/missing: game-category FitGirl repacks are relabeled as movies, accepted for preparation, and later fail as conversion-required; refresh failures are swallowed by an empty catch; API routes emit no consistent structured request logs or correlation identifier.
- Evidence: supplied screenshot shows `Pokemon Legends - Z-A [FitGirl Repack]` and `Pokemon - Sword & Shield [FitGirl Repack]` as MOVIE results, one failing at 92%; baseline source forces every result to the requested kind and explicitly sends no Prowlarr category filter.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Movie and series searches request the matching Prowlarr category and reject explicitly mismatched/non-video category results. | Focused Prowlarr regression tests plus normal Discover search | independently passed |
| AC-2 | A failed preparation or progress refresh stops the indefinite progress state and shows an actionable retry message with its request reference. | Playwright failure-path regression | independently passed |
| AC-3 | Every public API response carries a valid correlation ID and emits one structured completion log containing route, method, status, duration, deployment context, and no credentials, magnet URI, or unlocked URL. | Observability unit tests and route inventory policy test | independently passed |
| AC-4 | Discovery and AllDebrid operations emit safe structured outcome logs; unexpected failures retain stack/type server-side while the client receives a sanitized message and reference. | Unit/route tests with captured logger output | independently passed |
| AC-5 | Existing lint, unit, integration, build, accessibility, catalog, and playback behavior remain green. | Required local and CI gates | passing relevant local gates; exact CI pending |
| AC-6 | Exact merge commit is deployed, required dependencies are healthy, and real-catalog playback decodes then continuously advances on laptop and iPhone Safari paths. | Main CI/CD, `/api/health`, production verifier and playback suite/device evidence | pending |

## Risk and release
- Security/privacy/data risks: logs must never contain API keys, authorization headers, full query strings, magnet URIs, unlocked provider URLs, or request bodies; request IDs accept only a bounded safe character set.
- Compatibility/performance/accessibility risks: logging is synchronous JSON serialization to stdout/stderr with bounded fields; response wrapping must preserve streaming bodies, status, and headers; visible error references must remain screen-reader accessible.
- Rollout: focused branch and PR to `GDemay/Kheyflix` main, exact-head CI, merge, automatic Railway deployment, bounded production verification.
- Health signals and thresholds: all required checks green; exact deployed commit; `/api/health` overall healthy with required dependencies true; no new 5xx burst; first decoded frame and continuous playback on laptop/iPhone paths.
- Rollback/disable path: revert the merge through a canonical pull request if request handling, log safety, discovery relevance, or playback regresses.

## Verification log
- 2026-08-24, baseline `c17aa109`: screenshot and source inspection reproduce the defect: Prowlarr category metadata is overridden by the requested movie kind and no category constraint is sent.
- 2026-08-24, baseline `c17aa109`: refresh errors are silently swallowed in `DiscoveryPage`; API routes have no shared request-correlation or completion logging contract.
- 2026-08-24, production baseline `c17aa109`: public Pokémon movie search returned 18 releases, including four FitGirl game repacks, all declared as `movie`.
- 2026-08-24, RED: focused tests failed on missing Movies/TV category constraints, inclusion of an explicit PC Games category, absent observability module, and all nine uncovered API routes.
- 2026-08-24, GREEN: focused observability, category, health, and stream-route suites pass 21/21; every error response carries the same request ID as its completion event and sensitive fields/values are redacted.
- 2026-08-24, GREEN: Discovery failure path passes 12/12 on phone, tablet, and laptop; refresh HTTP 503 becomes a visible referenced error and retry action with matching browser diagnostic.
- 2026-08-24, local quality after independent repairs: 30 Vitest files / 169 tests pass; ESLint passes; production build passes; production dependency audit reports zero vulnerabilities; `git diff --check` passes.
- 2026-08-24, local playback: compatibility playback decoded and advanced on phone, tablet, and laptop; the Shrek live-catalog loader decoded and continuously advanced in isolated phone/laptop runs. The exhaustive 66-test run passed 49, skipped 3, and exposed known live-data screenshot drift plus provider/playback timing failures under the sequential load; the same playback suite also intermittently failed against untouched production while latest exact-main CI `32763681929` is green.
- 2026-08-24, independent acceptance: AC-1 and AC-3 passed on code/tests plus direct response-stream probes; AC-2 and AC-4 initially failed on network-only references and incomplete original-cause/provider sanitization, then passed after client-generated correlation, debrid-family outcome events, original-cause server logging, explicit public-message filtering, and credential-string redaction. Final focused independent probes and tests pass 8/8.
- 2026-08-24, final Discovery UI: 15/15 across phone, tablet, and laptop, including HTTP 503 and network-abort preparation failures with matching visible/logged references.
