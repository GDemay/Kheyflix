# Task contract: Repair the exhaustive QA findings

## Classification and scope
- Type: BUG
- In scope: Repair local transcoder reachability and compatible playback, make dependency health operational, preserve search state across history, render a recoverable invalid-watch state, and make title/profile dialogs keyboard-complete.
- Out of scope: Catalog curation, provider-account administration, dependency upgrades, unrelated visual redesign, and the user's pre-existing changes in the original worktree.
- Assumptions: Production keeps its explicit internal origins; local development remains loopback-only; an unavailable external provider must degrade honestly without taking down the web process.

## Baseline evidence
- Revision/environment: `372f6a2c17bd9699dae43c01aad9e3d41d62490c`, isolated macOS worktree, Node 25.8.2.
- User or client path: Run `npm run dev`, browse/search/open dialogs and invalid routes, then exercise direct and compatibility playback through the normal UI.
- Expected: Every reported workflow is coherent, keyboard-operable, and accurately represented by health signals.
- Actual/missing: The local app binds on `::1` while the transcoder calls `127.0.0.1`, required transcodes and media probes return 502, health reports broken dependencies healthy, browser Back clears the search field, invalid `/watch` is blank, and modal focus/Escape behavior is incomplete.
- Evidence: Baseline Playwright DOM/state runs; repeated 502 responses from media, transcode, probe, and discovery endpoints; ffprobe reports `127.0.0.1:3000` connection refused.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Local development exposes the app on the same loopback origin used by the transcoder; real media inspection, compatibility-only episode playback, selectable quality, audio, subtitles, and Retry work. | Launcher regression test, real local API/playback tests on laptop and phone | pass |
| AC-2 | `/api/health` distinguishes configured services from operational availability and never reports discovery/transcoder healthy when their functional readiness probe fails. | Health-route and provider/transcoder readiness tests plus local API check | pass |
| AC-3 | Search input, URL, heading, and results remain synchronized after result navigation, browser Back/Forward, direct URL entry, and refresh. | Browser regression test and normal-user search workflow | pass |
| AC-4 | Invalid `/watch/:id` renders a clear not-found message and working route back home. | Routing/UI regression test and direct-browser navigation | pass |
| AC-5 | Title-detail and profile-editor dialogs receive focus on open, close on Escape, trap Tab/Shift+Tab, restore focus on close, and keep background interaction unavailable. | Keyboard-focused browser regression tests and axe scan | pass |
| AC-6 | Existing catalog, profile, favorites, discovery error, responsive navigation, and direct playback behavior remain green. | Full unit, lint, build, UI, and real playback suites | pass; live-data screenshot drift documented below |

## Risk and release
- Security/privacy/data risks: Keep `.env.local` mode 0600, untracked, unlogged, and server-only; keep development services loopback-only.
- Compatibility/performance/accessibility risks: Health probes must be bounded and cached; focus management must not trap users after close; playback fallback must preserve direct-capable titles.
- Rollout: Focused pull request to `GDemay/Kheyflix` main, required CI, merge, Railway deployment, exact-commit health and real playback verification.
- Health signals and thresholds: Required PR checks green; deployed `/api/health` reports the merge commit and required dependencies healthy; first decoded frame under 10 seconds and continuously advancing playback on laptop and phone; no serious/critical axe violations.
- Rollback/disable path: Revert the merge through a pull request if exact-commit deployment checks or real playback regress.

## Verification log
- 2026-08-24, baseline `372f6a2c`: media/probe/discovery returned 502 while `/api/health` reported discovery and transcoder true.
- 2026-08-24, baseline browser: search query became empty after Back while URL/results remained `shrek`; invalid `/watch/not-real` rendered no content state; title dialog opened on BODY, ignored Escape, and leaked focus to background controls.
- 2026-08-24, RED: focused Vitest produced three expected failures for the launcher origin and operational health; four Playwright regressions failed for search history, invalid watch recovery, and title/profile keyboard behavior.
- 2026-08-24, GREEN: 24 Vitest files / 137 tests pass; ESLint passes; production build passes; `git diff --check` passes.
- 2026-08-24, GREEN: targeted QA regressions pass 4/4; provider failure followed by Retry passes on phone, tablet, and laptop; compatibility-only Friends S02E01 decodes and advances on all three profiles.
- 2026-08-24, GREEN: sequential real loader and playback tests pass 4/4 on phone and laptop, including first decoded frames, 20 seconds of continuous advancement, audio/subtitle controls, an explicit 480p restart, and post-switch advancement.
- 2026-08-24, GREEN: iOS 26.5 Simulator Safari opened the real Smiling Friends catalog path, created the 30-segment bootstrap HLS stream, entered the playing-driven standard-stream upgrade, and continuously generated 58 standard segments while the Safari session heartbeat remained active; the simulator was shut down after verification.
- 2026-08-24, GREEN: in-app browser verified search URL/input/result synchronization, initial dialog focus, Escape close, and focus restoration after returning to `/search?q=shrek`. Direct invalid-route browser recheck was interrupted by the browser-control connection; the same direct navigation and refresh are covered by Playwright.
- 2026-08-24, local readiness: media inspection returns 200 with video/audio/subtitle metadata; health reports transcoder operational and discovery unavailable, so overall status is honestly `degraded` while the local Prowlarr dependency is down.
- 2026-08-24, full Playwright matrix: 35/42 passed in one run. All six failures tied to checked-in screenshot baselines captured against changing live catalog content, plus one transient live-source timing failure that passed on rerun across all profiles. Snapshots were not regenerated because this audit is DOM/state-based and no objective visual review was authorized.
- 2026-08-24, dependency audit: production dependency audit reports zero vulnerabilities; the full development audit reports 11 transitive findings whose automated fixes require breaking dependency-range changes and are outside this contract.
- 2026-08-24, RED/GREEN launcher readiness: a deliberately delayed degraded-health response reproduced the 750 ms duplicate-launch race; the probe now allows the health route's bounded readiness checks, the regression passes, and a real second `npm run dev` exits cleanly with the existing app instead of starting a duplicate.
- 2026-08-24, independent verification FAIL: the first clean-context reviewer found that app-side transcoder probing could not prove the transcoder itself could reach the app, and that modal focus trapping did not remove header/footer/profile background controls from the accessibility tree.
- 2026-08-24, RED/GREEN independent-review remediation: transcoder `/health` now performs a bounded callback to the app's stream route; a deliberately wrong-origin transcoder reports `ok:false`/`appOrigin:false` while the correctly configured service reports both true. Health-route tests reject the false direction, and the normal second-launch guard remains green.
- 2026-08-24, RED/GREEN modal isolation: regression assertions first demonstrated that header and profile background controls remained exposed; open dialogs now mark and inert the full non-modal application background. Title/profile keyboard tests pass on phone, tablet, and laptop.
- 2026-08-24, final local gate after remediation: 24 Vitest files / 138 tests pass; ESLint passes; production build passes; 15/15 cross-device QA regressions pass, including established profile-storage compatibility; local `/api/health` truthfully reports discovery unavailable and transcoder operational.
- 2026-08-24, final responsive/accessibility gate: viewport containment, primary touch targets/navigation, and axe serious/critical checks pass 9/9 across phone, tablet, and laptop.
- 2026-08-24, independent re-verification FAIL: title dialogs correctly isolated the whole app, but the profile editor still left global header/navigation/footer controls in the accessibility tree; the reviewer also requested a real-process regression for health directionality.
- 2026-08-24, RED/GREEN final modal remediation: the strengthened profile regression reproduced the app-level leak, then passed after the editor moved to a body portal and temporarily inerts/aria-hides the complete application background. It verifies global header/navigation and profile controls are inaccessible while open and focus restores after cleanup on all three viewports.
- 2026-08-24, real-process health gate: two subprocess tests launch the actual transcoder. The correct app origin reports `ok:true`/`appOrigin:true`, while a deliberately unreachable origin reports both false.
- 2026-08-24, post-remediation gate: 25 Vitest files / 140 tests pass; ESLint passes; production build passes; 15/15 cross-device QA regressions pass; `git diff --check` passes.
- 2026-08-24, independent final verification PASS: no material defects found. The reviewer confirmed full app-level profile-modal isolation and cleanup, keyboard/pointer operation, zero serious/critical modal axe findings, real-process health directionality, real-catalog compatibility playback on phone/laptop, storage compatibility, secret hygiene, and the complete local quality gate.
