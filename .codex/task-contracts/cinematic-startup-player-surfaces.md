# Task contract: Cinematic startup and collision-free player surfaces

## Classification and scope

- Type: MIXED (startup feature and playback UX defect)
- In scope: add an original Kheyflix app-opening animation with a perspective rush toward the viewer; keep the full sequence at or below two seconds on phone and laptop; preserve reduced-motion behavior; make the playback video plane subtly grey when central controls are present; prevent pause/quick controls from overlapping initial loading, rebuffering, errors, or the iOS play prompt; deliver through `GDemay/Kheyflix` production.
- Out of scope: copying Netflix trademarks or assets, changing playback codecs/providers, redesigning the catalog, adding startup audio, or using demo/open movies as playback evidence.
- Assumptions: “same style” means a short cinematic depth/rush treatment using Kheyflix’s own K mark and colors; “only the video part” means dimming/desaturating the media plane while keeping controls crisp; the intro runs on a fresh browsing-app load and does not replay during client-side navigation.

## Baseline evidence

- Revision/environment: synchronized `origin/main` at `c17aa109bba568e99ce947ca4a158b32f5dd2a48`, local app at `http://localhost:3000`.
- User or client path: launch `/`; start a real catalog stream; reveal central controls while playback is starting, paused, or rebuffering.
- Expected: the app opens with a responsive Kheyflix depth animation that clears within two seconds; central controls gently grey only the video and are mutually exclusive with loading/error/iOS prompt surfaces.
- Actual/missing: a browser capture immediately after `/` showed no startup-intro element and only the blank loading shell; unused legacy player-intro CSS is desktop-only and lasts 2.4 seconds. The current player renders quick controls whenever `pausedByUser || (controls && playing)`, even while `loading`, and `.pause-overlay` paints a black full-screen backdrop (`#0008`) over the presentation.
- Evidence: local browser DOM capture (`introCount: 0`, no header yet, `Loading Kheyflix` shell), supplied 1536×1024 screenshot showing central quick controls over a black/loading surface, and current `StreamingPlayer`/CSS state conditions.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A fresh app launch immediately presents an original Kheyflix K perspective-rush animation on phone and laptop. | Startup Playwright test and browser visual verification | local pass |
| AC-2 | The normal-motion intro is fully cleared no later than 2,000 ms and never blocks interaction after it exits. | Computed-duration assertion plus timed browser assertion | local pass |
| AC-3 | Reduced-motion users receive no tunnel rush and the startup surface clears almost immediately. | Reduced-motion Playwright assertion and CSS media rule | local pass |
| AC-4 | During paused or visible quick controls, only the video plane receives a subtle neutral-grey shade; buttons and navigation remain crisp and accessible. | Playback state unit test, CSS/DOM assertion, and real browser visual verification | local pass |
| AC-5 | Initial loading, rebuffering, error, and iOS play-prompt states never render the pause/quick-control overlay; loaders and alerts remain unobscured. | Exhaustive playback-surface state matrix and real playback waiting-event check | local pass |
| AC-6 | Existing seek, pause/play, settings, audio, subtitle, adaptive-quality, recovery, and continuously advancing playback behavior remain intact. | Existing unit/UI suites and real-catalog laptop/phone playback | independent fail: local first-frame SLA |
| AC-7 | Exact merged revision is deployed with required dependencies healthy and real playback verified on laptop and iPhone Safari path. | CI, production `/api/health`, deployment verifier, production playback suite | pending |

## Risk and release

- Security/privacy/data risks: no new data flow or storage; `.env.local` remains ignored, mode `0600`, and server-only.
- Compatibility/performance/accessibility risks: fixed overlay stacking, GPU-heavy blur, mobile viewport sizing, hydration timing, and motion sensitivity. Use transform/opacity-only intro motion, a lightweight media-plane shade, no focus capture, and an immediate reduced-motion path.
- Rollout: focused pull request to canonical `main`; merge only after local, independent, and exact-head CI gates pass; automatic Railway production deployment.
- Health signals and thresholds: all required CI green; `/api/health` reports the exact merge commit with status `ok` and AllDebrid/discovery/transcoder healthy; intro clears by 2,000 ms; first decoded frame remains under the existing 10-second threshold and playback advances continuously.
- Rollback/disable path: revert the merge commit through the guarded pull-request workflow if startup blocks interaction, visual state collisions recur, or playback/health regresses.

## Verification log

- 2026-08-24, baseline `c17aa109`: authorized remote, SSH identity, hooks, and commit identity confirmed; branch `originator/netflix-style-startup` created directly from synchronized `origin/main`.
- 2026-08-24, local baseline browser: fresh `/` had no startup-intro element (`introCount: 0`) and displayed only the blank hydration/loading shell.
- 2026-08-24, baseline playback analysis: pause/quick controls are not gated by `loading`; their full-screen black backdrop sits below the loader by z-index but remains rendered and can obscure/collide during state transitions.
- 2026-08-24, RED unit gate: focused playback suite failed all six new surface-matrix cases because no centralized playback-surface resolver exists.
- 2026-08-24, RED user-interface gate: laptop normal- and reduced-motion startup tests failed because `.app-startup-intro` is absent from the fresh app launch.
- 2026-08-24, focused GREEN: playback surface suite passed 22/22, including initial load, rebuffer, error, pre-first-frame iOS prompt, post-first-frame iOS user pause, desktop pause, and playing quick controls.
- 2026-08-24, production-build browser GREEN: normal- and reduced-motion startup tests passed on phone and laptop (4/4); computed normal duration is 1.8 seconds, the surface is fixed and pointer-transparent, and reduced motion removes tunnel animation.
- 2026-08-24, visual inspection: laptop 1440×900 and phone 390×844 captures at 620 ms show the original red K moving through a radial depth tunnel; artifacts `/tmp/kheyflix-startup-laptop.png` and `/tmp/kheyflix-startup-phone.png`.
- 2026-08-24, real-catalog desktop transition GREEN: decoded playback exposed quick controls with the video-only filter; a synthetic `waiting` media event removed controls/filter and exposed only the buffering status; the focused Playwright path passed.
- 2026-08-24, local quality: lint and production build passed. Full deterministic suite passed 164/166; two pre-existing media-sync probes timed out under concurrent host FFmpeg load. Responsive geometry, touch-target, and accessibility checks passed on phone/tablet/laptop; existing home/discover visual snapshots differed even though the candidate does not change those surfaces.
- 2026-08-24, real-catalog extended playback gate remains blocked by local provider/host contention: one phone run decoded at 7.1 seconds but reset during the later quality checkpoint; one laptop run decoded at 19.7 seconds, above the existing 10-second threshold; server logs recorded a provider stream decode error. Assertions were not weakened.
- 2026-08-24, independent Sol/light review: AC-1 through AC-5 PASS. Full deterministic suite and build PASS. AC-6 FAIL because independent isolated candidate playback decoded at 14.529 seconds on phone and 20.048 seconds on laptop, above the existing 10-second SLA; AC-7 UNVERIFIABLE before delivery. Review verdict remains FAIL pending staging/production-grade playback evidence.
- 2026-08-24, local deterministic rerun after host FFmpeg contention cleared: 28 files / 167 tests PASS, including the three media-sync integration tests.
- 2026-08-24, deployment-safety RED/GREEN: an unlinked `npm run deploy:staging` silently created redundant Railway project `e65db96b`; a new focused test first failed because deploy targets were implicit, then passed after staging and production were pinned to exact project/environment/service IDs.
- 2026-08-24, Railway topology repair: canonical project `aa2423af` now contains isolated `staging` (`950f9a22`) and `production` (`ed9b7bff`) environments; staging Kheyflix and Prowlarr instances are healthy at the canonical staging domain. Redundant projects `e65db96b` and `fe696b30` were scheduled for deletion at the user's request.
- 2026-08-24, canonical staging baseline: `/api/health` reports `ok` with AllDebrid, discovery, and transcoder healthy; deployment verifier passed with 689 catalog records, 449 ready records, and 3,630 playable video files. Exact candidate deployment and playback remain pending.
- 2026-08-24, post-repair local gate: 29 test files / 170 tests PASS; lint PASS; production build PASS with only the existing large-chunk advisory.
