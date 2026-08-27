# Task contract: MKV progressive streaming

## Goal alignment
- Active goal objective: Deliver MKV movie eligibility and true stream-on-demand playback from the remote AllDebrid source, with complete local, independent, CI, deployment, health, and real-device-class playback evidence.
- Authoritative inputs: User request and explicit `$autonomous-tdd-delivery` instruction; repository `AGENTS.md`; `docs/deployment.md`; `.github/workflows/ci.yml`; baseline catalog, discovery, playback, AllDebrid, and transcoder code; `kevinnadar22/mkvstreamer` at `97138925d7cbb92bf2bda943499ec9927b199d08` as an architectural reference only.
- Baseline revision: `a28dc7b25363abec73a71e76b9bd2327a902fce8` from canonical `origin/main`.
- Verifiable stopping condition: A real live-catalog MKV movie is discoverable/preparable and starts browser-compatible playback without a complete Kheyflix-side file download, then continuously advances on laptop and iPhone Safari/device-class playback; the exact merged revision is healthy in production with all required gates green.
- Goal/task-contract differences: None. “No download” means Kheyflix reads the authenticated remote AllDebrid stream progressively; AllDebrid must still expose a ready/unlockable remote source before playback can start.

## Classification and scope
- Type: MIXED (remove the MKV exclusion and add an MKV compatibility route).
- In scope: Admit `.mkv` movie releases in scoped and fallback discovery; retain ready MKV movie files in the catalog and discovery preparation flow; mark them for the existing server-side FFmpeg compatibility path before the browser requests native Matroska; prove the transcoder consumes the remote HTTP input and emits progressive browser-compatible bytes/HLS without storing a complete source file.
- Out of scope: Direct torrent-piece streaming before AllDebrid exposes an unlockable link; importing the unlicensed reference implementation; supporting every other excluded container; changing secrets, provider accounts, Railway resources, or demo fixtures.
- Assumptions: MKV may contain browser-incompatible video/audio and therefore always uses Kheyflix compatibility playback. Existing MP4/M4V native behavior and existing series behavior remain intact. Explicitly incompatible non-MKV movie releases remain excluded unless separately requested.

## Baseline evidence
- Revision/environment: Canonical `origin/main` `a28dc7b2`; clean isolated worktree on `originator/mkv-progressive-streaming`.
- User or client path: Search for an MKV movie, prepare it, wait for AllDebrid readiness, open Watch, and load the selected source in a browser.
- Expected: MKV is offered, becomes watchable when ready, and immediately selects compatible progressive playback.
- Actual/missing: `app/lib/prowlarr.ts` rejects `.mkv` movie releases; `app/lib/media-parser.ts` admits only MP4/M4V movie files; `app/discovery-page.tsx` labels a ready MKV as unavailable; MKV compatibility is otherwise only discovered after a media probe or native playback failure.
- Evidence: Existing baseline tests assert that MKV discovery/catalog/preparation is excluded (`app/lib/prowlarr.test.ts`, `app/lib/media-parser.test.ts`, `tests/ui/discovery-compatibility.spec.ts`). The reference project documents remote-URL FFmpeg-to-HLS segment generation without a full download; it has no license file, so only the architecture is used.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A scoped or fallback movie discovery result that is explicitly MKV remains eligible, including MKV containing codecs that require conversion; unrelated incompatible non-MKV releases remain excluded. | Focused `app/lib/prowlarr.test.ts` regressions | local pass |
| AC-2 | A ready MKV movie appears in the catalog/preparation result and is marked for compatibility playback; MP4/M4V direct play and auxiliary-file filtering are preserved. | Focused parser tests and discovery Playwright test | local pass |
| AC-3 | Pressing Watch for the prepared MKV navigates directly to the compatibility route, without first attempting native Matroska playback. | Discovery Playwright route assertion | local pass |
| AC-4 | MKV compatibility playback reads from the authenticated remote stream and begins emitting fragmented MP4/HLS output without creating or waiting for a complete source file. | Transcoder command/integration regression plus real local API playback | local pass |
| AC-5 | A real live-catalog MKV produces a decoded first frame and continuously advances on laptop and iPhone Safari/device-class playback. | Local/staging/production playback artifacts | local pass; production pending |
| AC-6 | Existing playback, security, observability, accessibility, and resource limits remain green. | Full unit, lint, build, affected UI suites, CI, health and production verifier | local pass; CI/production pending |

## Risk and release
- Security/privacy/data risks: Remote media URLs and all provider keys remain server-side; no raw external URL is accepted from the browser; no secret values may enter logs, tests, browser bundles, or tracked files.
- Compatibility/performance/accessibility risks: MKV may require CPU-heavy HEVC/audio conversion; existing job caps, quality bootstrap, timeouts, abort handling, and temporary-segment cleanup must remain effective. The Watch state and player controls must remain keyboard/accessibility compatible.
- Rollout: Branch and canonical pull request to `main`, green exact-head CI, merge through PR, then automatic Railway production deployment.
- Health signals and thresholds: Exact merge commit from `/api/health`; status `ok`; AllDebrid, discovery, and transcoder healthy; required CI/CD green; decoded first frame and continuously advancing real playback on laptop and iPhone Safari/device-class run.
- Rollback/disable path: Revert through a canonical pull request if post-deploy MKV routing causes a harmful regression. Any Railway control-plane action requires the canonical `railway` MCP and exact production IDs.

## Verification log
- 2026-08-27, baseline sync: `git pull --ff-only origin main` could not run because the original checkout has unresolved user conflicts; preserved it untouched, fetched canonical `origin/main`, and created the clean worktree at exact revision `a28dc7b2`.
- 2026-08-27, boundary verification: canonical fetch/push URL, repository-scoped SSH identity with `IdentitiesOnly=yes`, `.githooks`, GDemay commit identity, ignored `.env.local`, and mode `0600` all confirmed.
- 2026-08-27, reference review: `mkvstreamer` commit `97138925` uses FFmpeg against a remote URL and generates HLS segments on request; no license file is present, so no source is copied.
- 2026-08-27, baseline focused gate: Existing parser/discovery/playback suites passed 54/54 and confirmed the old exclusion contract.
- 2026-08-27, RED: New parser and discovery regressions failed for the intended reason—ready MKV movies produced no catalog item and MKV discovery returned no result (2 failed, 30 existing tests passed).
- 2026-08-27, focused GREEN: Parser, discovery, playback compatibility, and progressive-streaming tests passed 59/59. The transcoder now uses the authenticated remote stream route and normal HLS keeps a bounded 8-segment playlist plus four deletion-threshold segments instead of accumulating the full title.
- 2026-08-27, UI GREEN: Discovery compatibility suite passed 12/12 across phone and laptop profiles; a ready MKV exposes Watch and navigates directly to `?compat=1`.
- 2026-08-27, live RED/recovery: A short live smoke decoded quickly but a 20-second gate exposed two pre-existing transition defects: auto-quality committed a stale timestamp, then a late prewarm abort could kill real playback because both requests reused one transcoder token. The test remained strict; the player now commits the latest absolute time and gives prewarm/real playback separate sessions.
- 2026-08-27, real laptop/phone GREEN: Live catalog title `How To Train Your Dragon Homecoming` (`72935164/0`, MKV) passed four consecutive 20-second runs (two phone, two laptop). First frames were 0.559–7.262 seconds and each timeline checkpoint advanced monotonically; no blocking stream `HEAD` request or playback alert occurred.
- 2026-08-27, iPhone Safari GREEN: Real iPhone 17 / iOS 26.5 Simulator Safari loaded the same local candidate MKV muted, decoded video, and produced four distinct frame captures sampled every three seconds across a further 12-second window. Device volume remained fully down and playback was stopped afterward.
- 2026-08-27, final local quality gate after repairs: 34 Vitest files / 205 tests pass; ESLint passes; production build passes; focused discovery/MKV UI flow is green on phone/laptop. Local app reports AllDebrid and transcoder operational; local Prowlarr private-network readiness is unavailable, so production discovery health remains a required release gate.
- 2026-08-27, independent contention RED/recovery: The clean-context verifier reproduced a desktop HTTP 429 during Auto quality promotion. The bootstrap stream and prewarm briefly occupied both job slots while the promoted stream began before asynchronous prewarm cancellation removed its slot. A new RED unit regression requires an explicit prewarm-session POST release; the player now awaits that release before switching and also releases on prewarm failure.
- 2026-08-27, contention GREEN: 34 Vitest files / 206 tests, ESLint, production build, and two consecutive strict real-MKV laptop runs pass after the capacity fix. The new runs decoded in 0.669–1.459 seconds and advanced through four monotonic five-second checkpoints without alerts or 429 responses.
- 2026-08-27, independent post-fix RED: A second clean-context verifier confirmed 206/206 tests and advancing playback, but exposed a still-hidden 429 from the Auto prewarm request when another active device occupied a job slot. The live test only logged media 4xx responses, so it was tightened to fail on any media HTTP error.
- 2026-08-27, bootstrap reclamation GREEN: The transcoder now identifies short startup jobs as immediately reclaimable when capacity is needed for quality promotion, while normal active jobs retain the abandoned-session grace period. The new unit regression was RED before implementation and GREEN afterward. With a persistent iPhone HLS session still connected, the tightened zero-4xx real-MKV gate passed sequentially on phone and laptop: decoded first frames 1.181s/0.592s and timelines 5→10→15→20 / 5→9→14→19.
- 2026-08-27, independent final PASS: The clean-context verifier passed the immutable post-build candidate on phone and laptop in one sequential run. Phone decoded in 1.410s and laptop in 0.615s; both timelines advanced 5→9→14→19 with no media HTTP failure, blocking stream HEAD, playback alert, or stalled checkpoint. The earlier empty-response run was traced to a production build replacing a live server's hashed client asset; restarting only after the build conclusively removed that test-fixture artifact.
