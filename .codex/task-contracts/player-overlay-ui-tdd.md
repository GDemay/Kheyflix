# Task contract: Desktop player overlay UI

## Goal alignment
- Active goal objective: Deliver the desktop pointer-overlay fix from baseline `d5a5126e751dd44d0909dd52c6bd7d0b67e2727d` through production, proving the real UI before and after while preserving paused controls, touch controls, and playback behavior.
- Authoritative inputs: User request and screenshots; repository `AGENTS.md`; `app/streaming-player.tsx`; `tests/ui/playback.spec.ts`; `package.json`; `docs/deployment.md`; `.github/workflows/ci.yml`.
- Verifiable stopping condition: Exact merged commit is healthy in production; real catalog playback advances on laptop and iPhone; desktop mouse movement reveals only standard chrome; explicit pause retains accessible central controls; independent verification passes.
- Goal/task-contract differences: none.

## Classification and scope
- Type: BUG
- In scope: Desktop/fine-pointer controls displayed during active playback; paused-state central transport controls; control auto-hide; touch behavior regression protection.
- Out of scope: Streaming/provider algorithms, media timing, settings layout, catalog behavior, and unrelated visual redesign.
- Assumptions: “Industry standard when I move my mouse” means the top/bottom playback chrome appears without large central transport buttons or a full-screen dimming layer while video is playing. Explicit pause may retain those central controls.

## Baseline evidence
- Revision/environment: `d5a5126e751dd44d0909dd52c6bd7d0b67e2727d`; production laptop browser at `https://kheyflix-production.up.railway.app`.
- User or client path: Open a real catalog title, start playback, wait for chrome to hide, then move the mouse over the video.
- Expected: Standard top/bottom chrome appears without central quick controls obscuring the movie.
- Actual/missing: `.player-shell` becomes `controls-visible` and the full-screen group labelled “Playback quick controls” appears with Back 10, Pause, and Forward 10 controls.
- Evidence: User screenshots; in-app browser DOM observation; production command `PLAYWRIGHT_BASE_URL=https://kheyflix-production.up.railway.app npm run test:ui -- tests/ui/playback.spec.ts --project=laptop --grep "pointer movement reveals central"` passed the baseline assertion of the defect.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | During active laptop playback, mouse movement reveals standard player chrome without a central quick-control overlay or full-screen dimming layer. | Laptop Playwright plus pre/post UI screenshot/DOM evidence. | local pass |
| AC-2 | Desktop chrome auto-hides after the established inactivity delay while playback remains active. | Deterministic laptop Playwright clock assertion. | local pass |
| AC-3 | Explicitly pausing exposes accessible Play, Back 10 seconds, and Forward 10 seconds central controls. | Laptop Playwright pause/resume flow. | local pass |
| AC-4 | Coarse-pointer/touch playback retains current central quick controls. | Phone Playwright regression. | local pass |
| AC-5 | Real catalog playback decodes and continuously advances on laptop and iPhone in staging and production, with no player alert. | Staging and production playback suites plus browser observations. | pending |
| AC-6 | Exact candidate and merge revisions pass local gates, independent verification, PR CI, deployment health, and production commit verification. | Commands, PR checks, `/api/health`, deployment verifier, canonical URLs. | pending |

## Risk and release
- Security/privacy/data risks: None expected; no secrets, API contracts, or browser data flow change.
- Compatibility/performance/accessibility risks: Preserve touch controls, keyboard pause/resume, accessible group/button names, and the existing 2.8-second timeout.
- Rollout: Candidate to staging, canonical PR to `GDemay/Kheyflix:main`, CI, merge, automatic Railway production deployment.
- Health signals and thresholds: Required CI green; `/api/health` exact commit and required dependencies healthy; first decoded frame within repository test threshold; playback time advances continuously without alert.
- Rollback/disable path: Railway rollback for harmful deployment plus normal revert PR; verify recovery before further repair.

## Verification log
- 2026-08-24, baseline `d5a5126e`, production in-app browser: real title playback started and advanced; after controls hid, pointer movement made `controls-visible` and exposed “Playback quick controls”.
- 2026-08-24, baseline production Playwright: existing pointer test passed because it expects the reported defective central overlay.
- 2026-08-24, RED, local laptop Playwright: expected zero “Playback quick controls” groups after mouse movement, received one.
- 2026-08-24, GREEN, focused verification: 3/3 player policy tests passed; laptop pointer/pause/timeout flow and phone touch regression passed with expected cross-project skips.
- 2026-08-24, GREEN, real local UI: Smiling Friends playback advanced from 11.810 s to 13.267 s while mouse movement revealed `controls-visible`; central quick-control count remained zero and the picture was unobstructed.
- 2026-08-24, GREEN, full local quality: Vitest 31/31 files and 172/172 tests passed after closing temporary browser playback tabs that had starved FFprobe; ESLint passed; Vinext production build passed.
- 2026-08-24, GREEN, independent verification at `29d6c194`: policy unit tests passed 3/3; deterministic laptop pointer/pause/timeout flow and phone touch regression passed 2/2 with expected cross-project skips; `git diff --check` passed.
- 2026-08-24, Railway MCP recovery: Codex MCP registry reported `railway` enabled; MCP `whoami` authenticated as the expected account and resolved the canonical workspace, project, staging/production environments, and services.
- 2026-08-24, staging control-plane probe: Railway deployment `7cdb3c83-df14-4544-84d3-0675da8d774b` reached `SUCCESS`, but Railway classified it as a redeploy and returned null Git provenance. It is not accepted as exact-candidate staging evidence; candidate must first be pushed and redeployed with verifiable `/api/health` commit identity.
