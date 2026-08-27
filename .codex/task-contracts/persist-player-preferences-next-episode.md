# Task contract: Persist player preferences across episodes

## Goal alignment
- Active goal objective: Preserve and reapply the viewer's saved player configuration when Next episode loads, then deliver and verify the exact merged revision through production.
- Authoritative inputs: User request; repository `AGENTS.md`; autonomous TDD workflow; `origin/main` revision `582674c92c3c98270b680efb15c7e4e75e8053a1`; `app/streaming-player.tsx`; `app/lib/playback-preferences.ts`; existing unit/UI tests; `.github/workflows/ci.yml`; `README.md`; `docs/deployment.md`; `docs/observability.md`.
- Verifiable stopping condition: The exact merge commit is green in PR and main CI, reported by production health, and a real live-catalog episode transition retains the supported configuration while laptop and iPhone playback decode and continuously advance.
- Goal/task-contract differences: none.

## Classification and scope
- Type: BUG
- In scope: Persist audio language, subtitle language/off state, subtitle size, playback rate, audio sync, and quality mode; restore them for the next episode; preserve safe fallback when a requested track or quality is unavailable; add regression coverage.
- Out of scope: Account synchronization, unrelated player redesign, discovery/provider changes, volume persistence, secret/config changes, or demo media.
- Assumptions: “config, subtitle, anything” means all choices exposed in the player's audio, subtitle, and playback-settings menus. Volume is a transport control rather than a configuration menu choice and remains device/session behavior.

## Baseline evidence
- Revision/environment: `582674c92c3c98270b680efb15c7e4e75e8053a1`, clean isolated worktree.
- User or client path: Select non-default audio/subtitle, subtitle size, quality, speed, and audio sync; activate Next episode.
- Expected: The next episode reapplies each saved preference when supported.
- Actual/missing: `PlaybackPreferences` has no subtitle-size or quality fields, their controls only update component state, and there is no episode-transition regression test.
- Evidence: RED user-path test and focused failure log recorded below before implementation.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Next episode retains the selected audio language and selects the matching track when available. | Mocked browser episode-transition test; real catalog verification. | local pass |
| AC-2 | Next episode retains subtitle language or explicit Off and subtitle size, with safe fallback for unavailable/unsupported tracks. | Unit serialization/fallback tests; mocked browser transition test; real catalog verification. | local pass |
| AC-3 | Next episode retains playback speed and audio-sync correction. | Unit serialization test; mocked browser transition test. | local pass |
| AC-4 | Next episode retains quality mode and uses only a quality supported by the next source. | Unit validation test; mocked browser transition test. | local pass |
| AC-5 | Existing playback, navigation, accessibility labels, and corrupted/legacy preference fallback remain healthy. | Full tests, lint, build, laptop/iPhone user-path checks. | local pass |
| AC-6 | Exact merged revision is deployed and healthy, and real-title playback decodes a first frame and advances continuously after the episode switch on laptop and iPhone Safari/simulator. | PR/main CI, `/api/health`, production verifier, measured playback run. | pending |

## Risk and release
- Security/privacy/data risks: Browser-only non-sensitive preferences; do not expose or modify server secrets. Keep `.env.local` ignored and mode `0600`.
- Compatibility/performance/accessibility risks: Migrate legacy v1 payloads safely; clamp enum/number inputs; unavailable tracks/qualities must fall back; retain keyboard/buttons and labels.
- Rollout: `originator/*` branch, canonical PR to `main`, exact-head CI, PR merge, automatic Railway production deployment.
- Health signals and thresholds: Required dependencies healthy; health commit equals merge commit; no player alert; first decoded frame under existing threshold; playback advances by more than three seconds and continues across samples on laptop and iPhone.
- Rollback/disable path: If the merged deployment causes a harmful regression, stop promotion and use only an explicitly authorized safe Railway MCP rollback path; otherwise report `BLOCKED_UNSAFE_PRODUCTION`.

## Verification log
- 2026-08-27, baseline `582674c9`: synchronized `origin/main`; original checkout pull was blocked by pre-existing unresolved conflicts, so a clean worktree was created directly from fetched `origin/main` without disturbing them.
- 2026-08-27, baseline inspection: confirmed subtitle size and quality mode are absent from serialized preferences and no test covers persistence through Next episode.
- 2026-08-27, RED on `582674c9`: `npm test -- --run app/lib/playback-preferences.test.ts` failed because serialized preferences dropped `subtitleSize: "large"` and `qualityMode: "720"`.
- 2026-08-27, GREEN candidate: focused preference tests 5/5; episode-transition UI regression passed on phone and laptop projects after selecting French audio, English subtitles, large captions, 720p, 1.25× speed, and -0.4s sync through the controls.
- 2026-08-27, local gate: full Vitest suite 188/188, ESLint, and production build passed. The pre-existing Playwright port 4173 owner belonged to another worktree; this candidate was verified through its isolated local server on 4174.
