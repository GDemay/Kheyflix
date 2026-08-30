# Task contract: Single-flight playback startup reliability

## Goal alignment

- Active goal objective: deliver a production-ready Kheyflix with reliable real-title playback, evidence-backed release gates, and no unresolved P0/P1 streaming failures.
- Authoritative inputs: the user’s end-to-end quality mandate, repository `AGENTS.md`, the P0 teardown contract, and the exact canonical baseline `origin/main` commit `db76c97c24992cdac8e8f9bee79e79ad5efed71c`.
- Verifiable stopping condition: duplicate requests for one active playback token use one encoder without false capacity exhaustion, do not cross-serve a different request, keep a joined viewer alive through creator disconnect/backpressure, and do not let a metadata probe contend with HLS before a usable playlist is available.
- Goal/task-contract differences: none. This is one bounded P1 reliability slice; browser access-code entry and destructive Railway actions remain out of scope.

## Classification and scope

- Type: P1 production playback reliability bug.
- In scope:
  - Single-flight admission for concurrent progressive and HLS startup requests for the same immutable playback fingerprint.
  - Follower lifecycle, backpressure, cancellation, capacity, and startup-gate behavior while a shared encoder is warming.
  - Regression coverage using local fake encoders and the transcoder’s public HTTP contract.
  - Full local, independent, PR/CI, deployment, health, and production real-catalog playback verification required by `AGENTS.md`.
- Out of scope:
  - Provider credential/configuration changes, capacity increases, browser access-code entry, demo media, direct Railway changes, and unrelated product redesign.
- Assumptions:
  - A caller reusing a token for a different immutable request receives a deterministic conflict rather than another caller’s stream.
  - Metadata should yield only until a shared fixed-profile HLS stream has a usable playlist, even if the request that created the encoder disconnects.

## Baseline evidence

- Revision/environment: isolated `originator/startup-singleflight` worktree based on `db76c97c24992cdac8e8f9bee79e79ad5efed71c`; canonical SSH remote, hooks, and commit identity verified.
- User/client path: two simultaneous player source requests use one token while the encoder is still starting; one request may disconnect while the other stays active and the player asks for media metadata.
- Expected: one encoder serves compatible callers, a different request cannot join it, cancelling one viewer does not interrupt another, and metadata waits for the first usable HLS playlist.
- Actual/missing: same-token pending startup had been treated as capacity exhaustion. Iterative adversarial review then exposed creator-abort metadata admission, a started-progressive conflict hole, cross-media HLS segment access under one token, a gateway cancellation that stopped all viewers, and a stale aborted HLS follower that could retain startup capacity.
- Evidence: each defect was reproduced through the public local HTTP contract before its repair, including raw independent client disconnects, delayed HLS playlists, and a gateway response cancellation.

## Acceptance criteria

| ID | Observable requirement | Test/evidence | Status |
|---|---|---|
| AC-1 | Compatible concurrent progressive/HLS startup requests return normally from exactly one encoder and do not report false capacity exhaustion. | Public transcoder HTTP regression tests; health capacity assertions. | local pass; CI pending |
| AC-2 | Disconnecting the creator, a backpressured follower, or an individual progressive gateway response does not stop or deadlock an active compatible follower. | Public transcoder HTTP regressions plus gateway cancellation coverage. | local pass; CI pending |
| AC-3 | A token reuse with a different media/options fingerprint is rejected deterministically and never joins/cross-serves the existing startup, including after progressive startup and for HLS masters or an explicitly option-overridden HLS segment; normal relative HLS segments remain playable. | Public transcoder HTTP regressions for progressive, HLS master, and HLS segment routes. | local pass; CI pending |
| AC-4 | A metadata probe remains deferred while a joined HLS follower waits for its first usable playlist after the creator disconnects, then proceeds normally; an aborted pre-ready follower cannot retain startup capacity. | Red/green delayed-HLS public HTTP regressions with a probe marker and capacity-release assertion. | local pass; CI pending |
| AC-5 | Existing teardown/capacity behavior, lint, unit, build, UI smoke, and WebKit coverage stay green. | Project local quality gates and exact-head CI. | local pass; CI pending |
| AC-6 | The exact merged/deployed revision reports healthy required dependencies and real live-catalog playback shows first decoded frame plus continuous advancement on laptop and iPhone Safari/device simulator. | Canonical PR/CI/CD, production verifier, real playback tests, and separately authorized manual Safari evidence. | pending / manual authorization required |

## Risk and release

- Security/privacy/data risks: do not read, copy, print, or expose `.env.local`, provider URLs, access codes, session tokens, or credentials; all tests use local fakes and no demo media.
- Compatibility/performance/accessibility risks: avoid extra encoder launches/capacity use; preserve HLS/progressive protocol behavior; metadata may not bypass a still-warming compatible stream.
- Rollout: branch → canonical PR → exact-head green CI → PR merge → exact-main deployment → required production health and real catalog playback checks. Railway control-plane inspection uses only its approved MCP; no write/destructive action is authorized here.
- Health signals and thresholds: no false `429` for compatible joins; no crossed request; no follower interruption; metadata marker absent before a usable delayed playlist and present after it; standard CI, health, and playback gates green.
- Rollback/disable path: revert the merge through a canonical PR if deployed playback startup, error rate, saturation, or first-frame behavior regresses.

## Verification log

- 2026-08-30: baseline workflow and prior P0 delivery were inspected; scoped SSH remote, hooks, and future commit identity were confirmed without accessing secrets.
- 2026-08-30: an independent review found and localized the HLS leader-abort metadata-gate race. The next step is a public HTTP red regression before implementation.
- 2026-08-30, RED: a delayed fixed-profile HLS encoder was started through the public transcoder HTTP route; a second master joined, the first raw HTTP client disconnected, and `/probe/42/0` was requested through a separate connection. Before a usable six-segment playlist existed, `/health` reported `probes: 1` rather than the required `0`. This deterministically reproduced premature metadata admission after creator disconnect.
- 2026-08-30, GREEN: the HLS job now owns and shares its startup gate. A detached creator does not release it while a compatible subscriber remains; the remaining master can release it after a usable playlist. The same public HTTP regression confirms `probes: 0` and no probe marker before playlist delivery, then `200` playlist and probe responses after readiness.
- 2026-08-30, focused local gates: 9 P1 startup/concurrency/follower/conflict/failure regressions passed; the complete transcoder lifecycle file passed 33/33; `node --check scripts/transcoder.mjs`, `git diff --check`, and `npm run lint` passed.
- 2026-08-30, full local gate: `npm test` passed 53 files / 374 tests; `npm run build` passed; `npm run test:ui:smoke` passed 110 with 19 project-declared skips; `npm run test:ui:webkit` passed 5/5. Expected mocked provider/format-error paths logged sanitized failures only.
- 2026-08-30, independent clean-context acceptance verifier: AC-1 through AC-4 passed against the public HTTP contract, including the HLS leader-disconnect metadata gate; it found no P0/P1 functional defect. Deployment and real-production criteria remain blocked on normal PR/CI/CD delivery, not on a local implementation failure.
- 2026-08-30, second adversarial review, RED: four additional public-contract failures were reproduced before repair: a started progressive stream accepted a different media request (`200`, expected `409`); a same-session HLS segment for different media returned `200`, expected `409`; an aborted pre-ready HLS follower could retain the startup subscriber/capacity; and cancelling a gateway GET issued a global `/stop/:token` request (two upstream calls, expected one).
- 2026-08-30, GREEN: progressive admission now rejects any nonmatching startup fingerprint; every HLS asset is bound to the job’s source key; aborted pre-ready HLS clients detach before subscription; and a gateway GET cancellation only cancels its own upstream response rather than the shared session. Focused regressions passed (3 transcoder + 1 gateway); the full transcoder lifecycle file passed 36/36 and gateway file 4/4.
- 2026-08-30, final full local gate: `npm test` passed 53 files / 378 tests; `npm run lint`, `node --check scripts/transcoder.mjs`, `git diff --check`, and `npm run build` passed; `npm run test:ui:smoke` passed 110 with 19 project-declared skips; `npm run test:ui:webkit` passed 5/5.
- 2026-08-30, post-fix independent clean-context verifier: AC-1 through AC-4 passed through the public HTTP/gateway contracts, including the four latest repairs. It reported no P0/P1 defect; AC-5 remains locally evidenced and AC-6 correctly awaits PR/production evidence.
- 2026-08-30, final clean review, FAIL: a segment request for the same media/token with an explicitly conflicting HLS option (for example, `quality=480` under a `bootstrap` session) was served instead of rejected. The normal player’s relative segment requests are query-free and must remain valid.
- 2026-08-30, RED/GREEN: the new public HTTP regression first received `200` for that override (expected `409`). HLS jobs now retain immutable request options; master requests require the full fingerprint and segment requests validate only explicitly supplied options, allowing query-free relative assets. The targeted regression passed after the repair, including a normal segment `200` body assertion.
- 2026-08-30, final exact-candidate local gate after the option-isolation repair: full transcoder lifecycle 37/37; gateway route 4/4; `npm test` 53 files / 379 tests; `npm run lint`, `node --check scripts/transcoder.mjs`, `git diff --check`, and `npm run build` passed; `npm run test:ui:smoke` passed 110 with 19 project-declared skips; `npm run test:ui:webkit` passed 5/5.
- 2026-08-30, final fresh independent clean-context verifier: AC-1 through AC-4 all passed against public local HTTP/gateway contracts. It independently confirmed one encoder/no false rejection, disconnect isolation, media and explicit segment-option `409` isolation with a query-free segment `200`, and delayed HLS metadata/capacity behavior. AC-5 and AC-6 continue through exact-head CI and production evidence.
