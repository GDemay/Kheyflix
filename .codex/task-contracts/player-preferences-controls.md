# Task contract: Persistent English audio and familiar player controls

## Classification and scope
- Type: MIXED (feature and UX defect)
- In scope: default English audio selection; persistent user audio-language choice across titles and browser sessions; no branded Kheyflix loader after initial movie startup; redesigned playback settings; user-pause overlay with prominent play and 10-second seek controls; forward seek that requests/prepares the target stream; default Auto quality that starts lightweight and upgrades directly to the highest available quality once playback is stable.
- Out of scope: catalog redesign, subtitle-default changes, new transcoder formats, account-based cloud preference sync.
- Assumptions: "all future sessions" means durable browser-local storage for this device/profile; the saved language is global across Kheyflix rather than series-specific; when a saved language is unavailable, English is tried, then the media default, then the first track; the Kheyflix animation remains permitted only during the initial startup of each movie/episode.

## Baseline evidence
- Revision/environment: `b339a72b82c0fa2b267acdfaf7e14fc084a9f4f5` (`origin/main`), local application and existing real-catalog playback route.
- User or client path: open a real catalog title, inspect audio/settings, change synchronization, pause, and seek.
- Expected: English selected initially; manual language survives future sessions; sync/quality changes do not replay branding; pause has a dark familiar overlay with large play and ±10s; settings are compact and legible.
- Actual/missing: preferences contain no audio language; media initialization selects the source-default track; every transcoded restart sets `loading` and renders the branded shard loader; pause only exposes the bottom controls; settings use a long ungrouped list.
- Evidence: existing `app/lib/playback-preferences.test.ts`, `tests/ui/playback.spec.ts`, screenshots supplied with the request, and baseline source inspection.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | With no saved choice, an available English audio track is selected even when another track is source-default. | Preference-selection unit test and player UI test | local PASS |
| AC-2 | Selecting another audio language persists globally in local storage and is restored after a new page/browser session when available. | Serialization/selection unit tests and storage-backed player behavior | local PASS |
| AC-3 | Kheyflix branding appears only for initial title startup; sync, quality, audio, and seek restarts use an unbranded buffering treatment. | Player UI regression test | local PASS |
| AC-4 | A user-initiated pause darkens the video and presents large play, back 10 seconds, and forward 10 seconds controls; buffering/autoplay pauses do not falsely present it. | Player UI/accessibility test and visual browser verification | local PASS |
| AC-5 | ±10-second overlay controls and keyboard controls seek to bounded positions; transcoded forward seek starts a target stream request so data is prepared at the new position. | Unit/UI request assertion and real playback verification | local PASS |
| AC-6 | Playback settings are visually grouped, compact, responsive, keyboard accessible, and retain existing quality, speed, and synchronization functions. | UI assertions, lint, responsive browser verification | local PASS |
| AC-7 | A real catalog title decodes a first frame and playback continuously advances on laptop and iPhone Safari after deployment. | Production playback suite and measured logs | local PASS; production pending |
| AC-8 | Auto is the default quality mode, starts at the lightweight rendition, and upgrades directly to the highest available rendition after stable playback without replaying branding. | Quality-selection unit test, player UI request assertion, and real playback verification | local PASS |

## Risk and release
- Security/privacy/data risks: audio preference stores only a normalized language code locally; no secrets or media URLs are exposed.
- Compatibility/performance/accessibility risks: autoplay pause must not be mistaken for user pause; overlay controls need accessible labels and touch targets; stream restart behavior must remain compatible with native and transcoded playback.
- Rollout: standard pull request, required CI, merge to `main`, Railway production deployment.
- Health signals and thresholds: all required CI green; production `/api/health` exact merge commit with required dependencies healthy; first decoded frame under existing 10s threshold; playback advances more than 12s across production checkpoints on laptop and iPhone Safari.
- Rollback/disable path: revert the merge commit through the guarded pull-request workflow if production playback or health regresses.

## Verification log
- 2026-08-24, `b339a72`, repository guard checks and `git fetch origin main`: PASS; canonical remote/identity/hooks confirmed and clean baseline branch created.
- 2026-08-24, candidate working tree, `npm test`: PASS, 25 files / 147 tests.
- 2026-08-24, candidate working tree, `npm run lint`: PASS.
- 2026-08-24, candidate working tree, `npm run build`: PASS (existing chunk-size advisory only).
- 2026-08-24, candidate working tree, real-catalog Playwright laptop: PASS, first decoded frame 4,679ms, continuous absolute timeline, Auto bootstrap-to-Original, pause/seek/audio/settings/logo checks and post-switch playback.
- 2026-08-24, candidate working tree, real-catalog Playwright phone: PASS, first decoded frame 2,625ms and full acceptance path.
- 2026-08-24, candidate working tree, in-app visual inspection: PASS; grouped responsive settings and dark pause overlay with prominent Play/±10s controls visually confirmed; Auto reported Original and only an unbranded spinner appeared during handoff.
- 2026-08-24, independent clean-context verification: AC-1 through AC-6 PASS; AC-8 initially FAIL on native iOS path, repaired so native HLS now prewarms and switches from bootstrap directly to `bestAutoQuality`, then PASS on reinspection; AC-7 UNVERIFIABLE until deployment.
- 2026-08-24, repaired exact candidate, `npm test`: PASS, 25 files / 147 tests. Two earlier concurrent runs hit the unchanged 5s transcoder-health timeout under verifier/live-service load; isolated test passed 2/2 and the clean full rerun passed.
- 2026-08-24, repaired exact candidate, `npm run lint` and `npm run build`: PASS (existing chunk-size advisory only).
