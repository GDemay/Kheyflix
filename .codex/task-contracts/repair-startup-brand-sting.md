# Task contract: Repair startup brand mark and sting

## Goal alignment

- Active goal objective: repair the Kheyflix startup logo and add an audible original brand sting when browser policy permits, with local UI evidence and an open unmerged PR.
- Authoritative inputs: user request and supplied screenshot; repository `AGENTS.md`; synchronized `origin/main` revision `582674c92c3c98270b680efb15c7e4e75e8053a1`; existing `StartupIntro`, startup CSS, `brand-sting` implementation/tests, Playwright startup tests, CI workflow, and prior cinematic-startup task contract.
- Verifiable stopping condition: the exact PR head is present on `GDemay/Kheyflix`, locally passes focused and full quality gates, has criterion-level independent verification and phone/laptop visual plus Web Audio evidence, and all exact-head PR checks are green; the PR remains open and unmerged.
- Goal/task-contract differences: none.

## Classification and scope

- Type: BUG.
- In scope: replace the visibly malformed overlapping startup K geometry with one coherent K silhouette; connect the existing original synthesized Kheyflix sting to startup; defer/resume it on the first trusted pointer or keyboard interaction when autoplay policy suspends Web Audio; retain deterministic cleanup; add regression coverage; validate locally on phone and laptop; open a canonical PR.
- Out of scope: merge, deploy, Railway or production work, catalog/player redesign, provider/playback changes, third-party logo/audio assets, demo/open-movie fixtures, or exposing secrets.
- Assumptions: “do not make any sound” means the startup mark should have its own short audible sting. A fresh navigation may play immediately where browser policy allows; otherwise the pending sting plays on the first trusted user gesture. Reduced motion changes animation only and does not silently discard the requested sound. Browser policies remain authoritative and are not bypassed.

## Baseline evidence

- Revision/environment: `582674c92c3c98270b680efb15c7e4e75e8053a1`, local Vinext UI at `http://localhost:4173`, Chromium laptop viewport 1440×900.
- User or client path: open `/` with normal motion and observe the startup brand surface.
- Expected: a coherent recognizable K and an original audible startup sting, immediately or after the first policy-required gesture.
- Actual/missing: the K is three separately animated overlapping polygons whose arm geometry cuts into the stem and reproduces the supplied broken mark; startup never imports or calls `playKheyflixSting`.
- Evidence: `/tmp/kheyflix-startup-baseline.png`; Chrome Web Audio `WebAudio.contextCreated` count is `0` during startup; existing startup lifecycle tests pass 2/2, isolating the defect from timing and reduced-motion behavior.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Normal-motion startup renders one coherent K silhouette with no independently separating arm/stem panels on phone and laptop. | Failing-first Playwright DOM contract, local phone/laptop screenshots, independent visual inspection | local pass |
| AC-2 | Startup schedules the original six-voice Kheyflix sting when Web Audio is already allowed. | Failing-first startup Playwright AudioContext instrumentation and focused unit test | local pass |
| AC-3 | When Web Audio starts suspended, no tones are scheduled prematurely; the first pointer or keyboard gesture resumes once, schedules once, and later gestures do not replay it. | Failing-first `brand-sting` unit tests | local pass |
| AC-4 | The startup remains pointer-transparent, clears within 2,000 ms, and reduced-motion users receive no tunnel rush. | Existing and extended startup Playwright tests on phone/laptop | local pass |
| AC-5 | Unsupported/failed Web Audio remains non-fatal and the app reaches the normal catalog UI. | Unit negative path and local UI assertion | local pass |
| AC-6 | Existing catalog, playback, accessibility, and build contracts remain unchanged. | Full unit suite, lint, build, and relevant local UI suite | local pass |
| AC-7 | The exact candidate is committed by the mandated identity, pushed only to canonical origin, opened as an unmerged PR to `main`, and exact-head CI is green. | Git/GitHub gateway checks and PR status/log inspection | pending |

## Risk and release

- Security/privacy/data risks: no new network, storage, or secret flow; `.env.local` remains ignored and mode `0600`; synthesized audio uses no external asset.
- Compatibility/performance/accessibility risks: autoplay restrictions, duplicate event listeners under React lifecycle behavior, AudioContext leaks, surprise replay, motion sensitivity, mobile SVG scaling, and visual seams. Use one pending context, once-only trusted gesture listeners, explicit cleanup, a single silhouette, transform/opacity animation, existing reduced-motion behavior, and no focus capture.
- Rollout: branch and canonical pull request only; no merge or deployment authorized.
- Health signals and thresholds: startup hidden by 2,000 ms; six oscillator starts exactly once; no console errors; focused/full tests, lint, and build pass; exact-head PR CI green.
- Rollback/disable path: close the unmerged PR or revert the branch commit locally; production is unaffected.

## Verification log

- 2026-08-27, baseline `582674c9`: authorized remote, repository SSH identity, hooks, commit identity, ignored environment mode, and clean isolated branch confirmed.
- 2026-08-27, baseline laptop UI: existing startup lifecycle/reduced-motion tests passed 2/2 through `PLAYWRIGHT_BASE_URL=http://localhost:4173`; screenshot `/tmp/kheyflix-startup-baseline.png` reproduces the supplied malformed overlapping K.
- 2026-08-27, baseline audio: Chrome Web Audio diagnostics observed zero created audio contexts during fresh startup.
- 2026-08-27, RED UI: coherent-silhouette assertion received 0 instead of 1; startup audio probe received `{ contexts: 0, starts: 0 }` instead of `{ contexts: 1, starts: 6 }`.
- 2026-08-27, RED unit: a suspended AudioContext was resumed immediately before any trusted gesture.
- 2026-08-27, focused GREEN: `brand-sting` passed 3/3 immediate, suspended-gesture, and unavailable-audio cases; startup Playwright passed 9/9 across phone, tablet, and laptop, including coherent silhouette, six scheduled voices, <=2 second exit, and reduced motion.
- 2026-08-27, local visual/audio evidence: `/tmp/kheyflix-startup-candidate-laptop.png` and `/tmp/kheyflix-startup-candidate-phone.png` show the continuous K at 620 ms; live Chrome Web Audio diagnostics recorded one context and 15 graph nodes on each viewport.
- 2026-08-27, local quality: full deterministic suite passed 32 files / 190 tests; lint passed; production build passed with only the existing large-chunk advisory.
