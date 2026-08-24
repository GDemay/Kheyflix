# Task contract: Player quick controls and profile position

## Classification and scope
- Type: BUG
- In scope: expose central pause, back-10-second, and forward-10-second controls whenever pointer movement reveals controls during active playback; keep the paused-state central play controls; anchor the profile control at the far right of the desktop header.
- Out of scope: playback transport behavior beyond the existing 10-second seeks, mobile touch interaction redesign, profile-menu content, catalog or provider behavior.
- Assumptions: "when I move a bit my mouse" means the existing player control-visibility window triggered by pointer movement; "top right" means the profile control's right edge remains within the header gutter and the search control sits immediately to its left.

## Baseline evidence
- Revision/environment: `926e354d3db69bcf240853d9c74583b040ee3ad7`, local laptop Chromium.
- User or client path: start a real catalog title, allow playback to advance, let controls hide, then move the pointer; open the home page at laptop width.
- Expected: pointer movement reveals central back-10, pause, and forward-10 controls; profile is anchored at the header's right edge.
- Actual/missing: the central overlay is rendered only after a user pause (`pausedByUser`); when search is closed no auto-margin consumes remaining header space, leaving the profile beside navigation.
- Evidence: failing Playwright criteria added before implementation and recorded in the verification log.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | During advancing desktop playback, moving the pointer reveals a central group with Back 10 seconds, Pause, and Forward 10 seconds. | Playwright real-playback test and laptop production playback run | independent local pass; production pending |
| AC-2 | The central quick-control group hides again after the existing inactivity timeout while playback continues. | Playwright real-playback test | independent local pass |
| AC-3 | Pausing still shows the central group with Play and both 10-second seek controls. | Existing Playwright real-playback regression | independent local pass |
| AC-4 | At laptop width, the profile control is the header's rightmost control and its right edge aligns within the configured header gutter. | Playwright responsive geometry test and visual check | independent local pass; production pending |
| AC-5 | Supported narrow layouts remain within the viewport and retain accessible controls. | Existing responsive/accessibility suites | independent local pass |

## Risk and release
- Security/privacy/data risks: none; no secrets or provider payloads are changed.
- Compatibility/performance/accessibility risks: overlay could intercept video clicks, obscure subtitles, or remain visible; header alignment could regress narrow navigation. Buttons retain accessible names and existing handlers; CSS remains responsive.
- Rollout: normal pull request and Railway production deployment through existing CI/CD.
- Health signals and thresholds: required CI green; `/api/health` healthy at the exact merge commit; first decoded frame under 10 seconds and playback advances on laptop and iPhone targets; no playback alerts.
- Rollback/disable path: revert the merge commit through the normal pull-request workflow if production acceptance or health fails.

## Verification log
- 2026-08-24, `926e354`, repository inspection: central overlay condition is `pausedByUser && !error`; closed-search header has no flexible spacer before profile.
- 2026-08-24, baseline, `responsive.spec.ts` laptop geometry: RED; profile right edge was 742.73 px from the header right edge.
- 2026-08-24, baseline, `playback.spec.ts` real catalog: RED; after pointer reveal no `Playback quick controls` group existed.
- 2026-08-24, candidate working tree, focused laptop geometry: PASS; profile is the rightmost visible header control within the header gutter.
- 2026-08-24, candidate working tree, focused real-catalog playback: PASS; pointer reveal showed Back 10 / Pause / Forward 10 and the group hid after inactivity.
- 2026-08-24, candidate working tree: `npm test` PASS (25 files, 149 tests), `npm run lint` PASS, `npm run build` PASS.
- 2026-08-24, candidate working tree, responsive suite: geometry, interaction, and serious/critical accessibility checks passed across targets; six screenshots remain red because the live catalog content differs broadly from stored snapshots, so snapshots were not overwritten.
- 2026-08-24, candidate working tree, existing real playback test: provider performance blocker before UI regression section on three runs (3.50 s advancement stall; then first-frame 12.26 s and 23.34 s against the unchanged <10 s gate).
- 2026-08-24, independent clean-context verifier: PASS AC-1 through AC-5. Real-catalog quick-control test passed in 29.1 s; direct pause regression passed with a 2.27 s first decoded frame; laptop profile geometry was rightmost with a 72 px viewport gutter; phone/tablet containment, touch, and Axe checks passed 6/6.
- 2026-08-24, merge `9a2359d8`, main CI: production commit and health verification passed; playback failed because the mouse-only quick-controls test also ran on the phone project. Existing phone and laptop real-playback cases passed.
- 2026-08-24, follow-up candidate, exact production playback command: PASS (phone real playback, laptop real playback, laptop mouse quick controls; phone mouse test intentionally skipped).
- 2026-08-24, merge `2b9b53a3`, main CI: exact production commit/health and phone/laptop playback passed, but the laptop mouse test required retries because controls sometimes remained visible across the bootstrap-to-original transition. Classified as a product timing race, not a completion pass.
- 2026-08-24, hide-race candidate: controls timeout uses the video element's live paused state instead of lagging React state; focused real-catalog regression passed 3/3 consecutive runs, with lint and 152 unit tests green.
