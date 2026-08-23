# Task contract: Rewarding live-stream loader

## Classification and scope

- Type: MIXED
- In scope: replace the live player intro/spinner with the responsive progress-driven Shard Portal loader; keep progress proportional to real startup time; complete immediately when playback is ready; preserve live playback and error recovery; make detail-modal close return to its catalog route; verify and deploy through `GDemay/Kheyflix`.
- Out of scope: demo/open movies, synthetic playback fixtures, catalog-content changes, provider credentials, unrelated player redesign.
- Assumptions: a real ready title in the authenticated AllDebrid catalog is available for non-destructive playback verification.

## Baseline evidence

- Revision/environment: `origin/main` at `03b1b3ba21fe702e469c1d956cbb1cffc3ad56a0`, local production-like development server.
- User or client path: open a real `/stream/{magnet}/{file}/{slug}` URL while media readiness is pending.
- Expected: staged K construction, continuous visible progress, completion reward, then a decoded and advancing live stream.
- Actual/missing: the baseline used a fixed intro plus generic buffering spinner and had no progress-coupled completion sequence; detail close could follow ambiguous browser history.
- Evidence: baseline source and user-visible preview; live regression target `/stream/701203060/0/shrek` from the authenticated catalog.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Live player shows the Shard Portal loader before the first decoded frame. | `tests/ui/live-loader.spec.ts` and independent browser verification | passing locally |
| AC-2 | Loader progress remains active for the real startup duration and completes when playback becomes ready. | Live loader status visibility followed by hidden state | passing locally |
| AC-3 | The completed loader reveals a decoded stream that advances by more than three seconds. | Laptop and phone Playwright live-catalog run | passing locally |
| AC-4 | Layout is responsive and reduced-motion behavior is preserved. | CSS breakpoints, reduced-motion rule, phone/laptop runs | passing locally |
| AC-5 | Closing title details returns to the originating catalog route rather than reopening playback. | Route-state implementation plus local browser path | passing locally |
| AC-6 | No demo/open movie is added or used as release evidence. | `AGENTS.md`, diff inspection, live catalog test path | passing locally |
| AC-7 | Exact merged commit is healthy and playable in production. | Production `/api/health`, verifier, laptop and iPhone Safari | pending |

## Risk and release

- Security/privacy/data risks: `.env.local` remains ignored, mode `0600`, server-only, and is never emitted to client code or logs.
- Compatibility/performance/accessibility risks: requestAnimationFrame loader work, reduced-motion behavior, mobile sizing, iPhone Safari startup, and transcoder saturation.
- Rollout: merge PR #26 only after exact-head CI and independent acceptance are green; wait for exact merge-commit deployment.
- Health signals and thresholds: production health must report the merge commit; required dependencies healthy; first decoded frame under 10 seconds on the selected direct-compatible live stream; current time advances by more than three seconds; no playback alert.
- Rollback/disable path: revert the merge commit through a canonical pull request if production acceptance or health fails.

## Verification log

- 2026-08-23, `86ab4e5d`, `npm run lint`, pass.
- 2026-08-23, `86ab4e5d`, `npm test`, 20 files / 112 tests pass.
- 2026-08-23, `6c205d4c`, `npm run build`, pass.
- 2026-08-23, local `/api/debrid/magnets`, HTTP 200 with 686 real catalog magnets after secure environment refresh.
- 2026-08-23, local `/stream/701203060/0/shrek`, phone 6.7 seconds and laptop 7.0 seconds; decoded frame and sustained advancement; pass.
- 2026-08-23, iOS Simulator resource audit, Simulator shut down after WindowServer reached approximately 99% CPU; final Simulator use restricted to one bounded production check.
