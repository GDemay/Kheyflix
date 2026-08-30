# Task contract: Reliable, access-controlled playback foundation

## Goal alignment

- Active goal objective: Deliver a production-ready, Netflix-quality Kheyflix by eliminating P0/P1 streaming, reliability, security, and product-experience issues, proving every release through the canonical PR/CI/deployment/real-Safari workflow.
- Authoritative inputs: User mission and follow-up authorization; repository `AGENTS.md`; `.github/workflows/ci.yml`; `docs/deployment.md`; `docs/observability.md`; the audited application, AllDebrid, Prowlarr, transcoder, and player code; production baseline on the canonical Railway IDs.
- Baseline revision: `c483cc0e45e2a773affa0e7f69e0b82e72ebad0b` from canonical `origin/main`, isolated from the user's conflicted original checkout. The policy-only prerequisite subsequently merged as `1a0ae288b819cd6d05502ab2234bc14dace8daf8`; this release branch is `originator/reliable-access-playback`.
- Verifiable stopping condition for this release slice: A configured, invite-only deployment denies unauthenticated provider access; a valid browser session can use the normal catalog and playback flow; bootstrap compatibility requests stay bootstrap end to end; and a real catalog title decodes and advances continuously on macOS Safari and iPhone Safari/device-class playback without the reproduced capacity failure. The exact merged revision must be green in CI/CD and healthy in production.
- Goal/task-contract differences: This is the first delivery slice of the broader active goal. It deliberately establishes a secure invite-only access boundary rather than claiming a complete public multi-account entitlement system; the latter remains a tracked product/platform follow-up that requires an explicit legal and commercial decision.

## Classification and scope

- Type: MIXED (P0 provider-account exposure, P1 playback capacity/startup regression, and deployment-policy reliability hardening).
- In scope:
  - A server-side access gate for all provider-backed APIs, with a secure browser session and a fail-closed production configuration path.
  - A minimal premium access surface that keeps the access secret out of browser bundles, URLs, logs, source, and tests.
  - End-to-end bootstrap quality preservation across player, gateway, and transcoder so startup work is reclaimable as designed.
  - Bounded, actionable compatible-playback failure behavior and sanitized startup/capacity diagnostics.
  - Request-scoped outbound HTTPS DNS pinning for the server relay, so validation and the actual media connection use the same public address set.
  - Regression coverage for anonymous denial, valid access, quality forwarding, capacity handling, and real-title Safari/Chromium playback.
  - Policy-safe Railway documentation/tooling remediation where it directly affects this release.
- Out of scope:
  - A paid identity vendor, public registration, billing, individual provider accounts, DRM, or legal/licensing decisions.
  - Enabling direct AllDebrid data-plane mode without independently validating its IP-trust model.
  - Destructive Railway changes, provider-library mutation for testing, demo/open-media fixtures, or secret disclosure.
- Assumptions:
  - Until a durable multi-account system exists, Kheyflix operates as a controlled invite-only service using a deployment-scoped access secret.
  - The access secret is generated and set only through the canonical Railway MCP after the code gate is ready; it is never emitted to chat, logs, tracked files, or client JavaScript.
  - Existing authenticated browser routes and the health endpoint remain available as appropriate; health never requires an end-user session.

## Baseline evidence

- Repository/production baseline: canonical remote, repository-scoped SSH identity, hooks, GDemay commit identity, and mode-0600 ignored runtime environment verified. The original checkout has unresolved user conflicts and is preserved untouched.
- Provider exposure reproduction: an anonymous public `GET /api/debrid/magnets` returned HTTP 200. Source confirms `POST /api/debrid/magnets` accepts only a client-controlled `rightsConfirmed` boolean and all stream/transcode/HLS/subtitle endpoints lack an access boundary.
- Playback reproduction:
  - `npm run verify:production` passed at the baseline (690 catalog records, 455 ready magnets, 3,681 video files, 25 discovery results).
  - Production real-title Chromium playback: 7 passed, 2 expected project skips, 1 laptop MKV failure. The failing route returned HTTP 429 and never reached `readyState >= 2` within 70 seconds.
  - macOS Safari loaded a real catalog title and displayed “We couldn’t start playback” at 12.8 seconds. One retry was still at `0:00`, “Preparing compatible playback”, after 25.6 seconds.
  - Production logs show the corresponding transcode 429 while stream data-plane requests were otherwise successful.
- Root cause: the player explicitly emits `quality=bootstrap`, but both `app/api/debrid/transcode/[id]/[file]/route.ts` and `scripts/transcoder.mjs` whitelist only `480`, `720`, `1080`, and `original`; the request is silently coerced to `original`. The intended short/reclaimable bootstrap job is therefore never created, so a native fallback consumes a full non-reclaimable FFmpeg slot and makes capacity starvation likely.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Provider-backed API routes deny a request without a valid browser access session and do not invoke AllDebrid, Prowlarr, or the transcoder. | Focused route/access tests, including anonymous catalog, upload, stream, transcode, HLS, subtitle, and media calls. | local evidence complete; production pending |
| AC-2 | A valid access code creates an HTTPS-only, HttpOnly, SameSite session without placing the secret in a URL, response body, browser bundle, or log; the regular catalog/playback journey then works. | Focused access-route tests, static secret-policy test, and normal browser journey. | local evidence complete; production pending |
| AC-3 | Production fails closed with a clear non-secret configuration error when an access secret is absent, while `/api/health` remains machine-readable and ungated. | Focused tests and production health after configuration. | local evidence complete; production pending |
| AC-4 | A player bootstrap request reaches the transcoder as `bootstrap`, produces a short/reclaimable startup profile, and is never silently upgraded to `original`. | RED/GREEN route/transcoder contract tests plus relevant header/command assertions. | local evidence complete; production pending |
| AC-5 | When capacity is unavailable, the user receives an actionable, bounded recovery path; stale/prewarm jobs cannot strand or starve an active real playback session. | Focused playback/transcoder tests and zero unexpected media 4xx assertions in live playback. | current candidate locally complete; exact-production proof pending |
| AC-6 | A real live-catalog title reaches a decoded first frame and then advances continuously for at least 20 seconds on macOS Safari and iPhone Safari (real device if available, otherwise simulator); Chromium remains an additional regression signal, not Safari evidence. | Measured browser/device artifacts on the exact deployed revision. | local evidence complete; exact deployed revision pending |
| AC-7 | The branch passes affected tests, full unit suite, lint, build, independent clean-context verification, exact-head CI/CD, production verifier, and deployment health checks. | Commands, PR checks/logs, Railway MCP state, and exact production commit. | current candidate local suite complete; independent review, PR, and production pending |

## Risk and release

- Security/privacy/data risks: The shared AllDebrid account remains server-side. The access secret and provider credentials must never be logged, printed, committed, put in screenshots, exposed through client code, or included in test fixtures. In-memory rate controls mitigate only a single instance and do not replace a future identity/entitlement system.
- Compatibility/performance/accessibility risks: Access gating must not break byte-range requests, HLS segment requests, Safari autoplay, health probes, or focus management. Bootstrap must lower admission pressure without replacing a playing source unexpectedly.
- Rollout: Branch → canonical PR → exact-head green CI → merge through PR → automatic canonical-main Railway deploy. Set the production access-secret configuration through Railway MCP with canonical IDs only and without a redeploy before the merge artifact is ready.
- Health signals and thresholds: `/api/health` returns the exact merge commit and healthy required dependencies; no unexpected 4xx/5xx in real playback; first decoded frame under 10 seconds for the native real-title path and under 30 seconds for compatible MKV; four monotonic five-second playback samples after the first frame; no stuck loader or playback alert.
- Rollback/disable path: Revert through a canonical PR if the release harms access or playback. Railway control-plane reads/writes use only the configured `railway` MCP and exact project/environment/service IDs. Destructive service/domain/storage/deployment operations require explicit confirmation even under the user’s broad project authorization.

## Verification log

- 2026-08-29, baseline synchronization: `git pull --ff-only origin main` was blocked by pre-existing unresolved user conflicts in the original checkout. It was preserved untouched; `origin/main` was fetched and the clean delivery worktree was created at `c483cc0e45e2a773affa0e7f69e0b82e72ebad0b`.
- 2026-08-29, operational baseline: Railway MCP `whoami` succeeded; canonical production project, environment, and service IDs resolved; `/api/health` and `npm run verify:production` passed at the baseline exact commit.
- 2026-08-29, RED playback evidence: production real-title suite failed one laptop MKV test after a transcode HTTP 429; macOS Safari reproduced the native-to-compatible failure and a stuck retry. The baseline source confirms the bootstrap quality contract divergence.
- 2026-08-29, RED security evidence: anonymous production catalog access returned HTTP 200; code inspection confirms no provider route authorization or server-side user identity boundary.
- 2026-08-29, policy prerequisite delivered: PR #64 merged as `1a0ae288b819cd6d05502ab2234bc14dace8daf8`; its exact main CI/CD run passed and production `/api/health` reported that commit with healthy required dependencies.
- 2026-08-29, current local GREEN evidence: the access boundary, opaque session, secretless CI exchange, bootstrap forwarding, telemetry, and production verifier changes pass the full unit suite (`50` files, `273` tests), lint, and build. Controlled browser regressions cover bootstrap recovery, paused native-HLS session replacement, and the stable Apple Auto policy.
- 2026-08-29, real local Safari evidence: a live Shrek catalog path decoded visibly and advanced continuously on macOS Safari; the iPhone simulator decoded visibly, advanced across a sustained run, paused at `0:34`, and resumed through a new native-HLS session with continuously advancing frames. Apple Auto intentionally remains at the reliable `480p` native-HLS rendition until a multi-variant manifest can switch quality without interrupting a live session. Production configuration, exact-head CI/CD, and the same real-Safari evidence on the exact deployed revision remain required before this slice can be accepted.
- 2026-08-30, final local GREEN evidence: the full unit suite passed (`53` files, `348` tests), lint and production build passed, and the deterministic UI smoke suite passed (`76` tests; `17` intentional platform-specific skips). Focused relay tests cover mixed public/private DNS rejection, canonical IPv4-mapped IPv6 rejection, numeric connection pinning with original TLS identity, redirect revalidation, bounded first byte, link refresh, ranges, cancellation, and access authorization.
- 2026-08-30, measured local Safari evidence: the real live-catalog title *Friends S01E01* first showed decoded video in macOS Safari by `12.507s`, then advanced from `3:15` to `4:32` over `80.451s`. The iPhone simulator showed decoded video by `7.552s` and still showed decoded video after `70.264s`; both traversed multiple finite 15-second VOD windows. After both clients returned home and bounded warming expired, the transcoder had zero active jobs and both capacity slots available, with zero startup timeouts, encoder exits, and capacity rejections. These are local-source measurements only; exact-release production proof remains open.
- 2026-08-30, CI feedback remediation: PR #65 exact-head CI caught a duplicate native-VOD session-release race that local timing had not surfaced. A finite-window handoff now deduplicates a successful awaited release from the later React effect cleanup, while preserving the fallback teardown path if that awaited request fails. The active-session regression passed five consecutive laptop repetitions; the full unit suite (`53` files, `348` tests), lint, build, and smoke suite (`76` passed, `17` intentional skips) passed again. Updated PR CI remains required.
- 2026-08-30, exact-main capacity regression: after PR #68 merged as `5f8abfc3bc67a2e5a01e6e968471dcb98e2d7be5`, its exact deployment was healthy but the live-catalog production playback gate observed a bootstrap `429`, recorded `failure` on attempt 1, then reached its direct fallback first frame on attempt 2. Read-only production diagnostics correlated the failure with a stale playback session during capacity admission. The strict attempt-1 assertion remains the release gate.
- 2026-08-30, RED capacity/cancellation evidence: two new focused lifecycle tests failed on the candidate baseline. An explicit stop issued while an original-quality request was queued behind stale-session reclamation still reached `ffprobe`; a disconnected subtitle request held a pending playback reservation through its delayed metadata probe.
- 2026-08-30, current local GREEN evidence: admission now serializes stale-session reclamation until the child closes, checks cancellation before and after admission, and records an explicit stop that arrives before a queued request owns a reservation. Subtitle metadata requests release their reservation immediately on client disconnect and remain guarded against a late spawn. The full unit suite passed (`53` files, `355` tests), lint and production build passed, lifecycle coverage passed all `18` cases, UI smoke passed (`98` passed, `19` expected skips), and the WebKit keyboard/focus suite passed (`5` tests). Independent verification, exact-head CI/CD, and deployed live-catalog Safari proof remain required.
- 2026-08-30, independent clean-context verification: a separate read-only verifier found no source-level release blocker in the new admission and cancellation paths, and independently confirmed the focused capacity regressions, lint, and build. It correctly marked AC-5 end-to-end, AC-6, and AC-7 unresolved until this candidate has an exact deployed revision with live-catalog Safari evidence.
