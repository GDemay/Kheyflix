# Task contract: Truthful playback teardown lifecycle

## Goal alignment

- Active goal: deliver a production-ready Kheyflix with reliable real-title playback, evidence-backed release gates, and no unresolved P0/P1 streaming failures.
- Baseline revision: `2a6cbd59c01c80fd192955ad4fae6d7d658ac259` on canonical `origin/main`, isolated in `originator/truthful-stop-lifecycle`.
- Authoritative evidence: exact main CI run `33299378379`, Railway deployment `c2e8c93d-4043-47da-ba55-1bff1bd1fc9f`, sanitized deploy logs, the transcoder, gateway, player, and production playback specifications.
- Release-slice stopping condition: a stop response is never reported as complete before its owned encoder has actually closed; a signaled HLS child cannot leak a capacity slot; a session replacement waits for confirmed release; and the exact merge clears the strict real-title first-frame/continuous-playback gate.

## Classification and scope

- Type: P0 production playback reliability bug.
- In scope:
  - Close-based process lifecycle tracking for HLS and progressive encoders, including signal termination and inherited-pipe safety.
  - Truthful stop status and retry semantics through transcoder, application gateway, and player source handoff.
  - Capacity admission wake-up when any capacity consumer releases, without early oversubscription.
  - Test isolation so control-only UI coverage does not covertly leave real catalog streams active; real-playback coverage retains real catalog titles only.
  - Sanitized lifecycle telemetry/logging that distinguishes pending teardown from confirmed close without tokens, URLs, titles, or credentials.
- Out of scope:
  - Capacity increases, provider credential/configuration changes, Railway writes, demo-media use, weakening first-frame assertions, or bypassing access controls.

## Reproduced production baseline

- Exact main CI validation passed lint, 359 tests, build, Chromium smoke, and WebKit keyboard coverage. The exact production playback job failed: 6 passed, 1 flaky, 1 failed.
- Phone real-title playback decoded and advanced (MKV first frame 1,144ms; movie first frame 709ms). Subsequent session transitions produced capacity `429`s; laptop movie first frames recovered only on source attempt `2` (~3.2s), failing the strict attempt-one gate.
- Sanitized Railway logs for the exact deployment show `activeTranscodes: 0`, `activeHls: 0`, `stopping: 1`, then `stopping: 2`, followed by bounded ~2.5s admission `429`s.
- Root cause A: a SIGKILLed HLS child has `exitCode === null` and `signalCode === 'SIGKILL'`. The HLS close handler only removed nonzero numeric exit codes, so the already-closed child remained in `hlsJobs`; a later stop subscribed to an event that had already fired, leaking a permanent `stoppingJobs` slot.
- Root cause B: stop waits race against the teardown budget but discard the timeout result; duplicate stops lose the child mapping and return immediately. The gateway normalizes all results to `204`, so the player can start a successor before release is confirmed.
- Amplifier: control-only production UI cases create real bootstrap streams and rely on best-effort beacon cleanup, allowing serial test sessions to overlap in teardown.

## Acceptance criteria

| ID | Observable requirement | Evidence |
|---|---|---|
| AC-1 | A signal-terminated HLS encoder is removed after `close`; a later stop never creates a permanent `stopping` slot. | New red/green transcoder regression with self-signaled HLS fixture. |
| AC-2 | A leader-exited but close-pending owned encoder remains capacity-accounted and a later stop kills its process group, while an escaped inherited pipe still remains safely bounded. | New POSIX lifecycle regression plus existing escaped-pipe coverage. |
| AC-3 | Only confirmed child closure yields a completed stop. Incomplete teardown returns a retryable pending response with the conservative retry hint; duplicate stops share the same lifecycle result. | New transcoder and gateway unit/integration regressions. |
| AC-4 | Player replacement sends no successor media GET until its old session has a confirmed release; a pending release is retried/bounded without incrementing source attempt. | Focused player/route regressions. |
| AC-5 | Non-playback UI tests create no real media requests; genuine production playback tests retain real live-catalog titles and explicit cleanup. | UI test assertions and production CI artifact. |
| AC-6 | Exact-head CI, exact-main CI/CD, public health, Railway status, and real-title production playback are all green on the same merge. | Canonical GitHub/Railway evidence. |
| AC-7 | Laptop Safari and iPhone Safari/device simulator show a first decoded frame and continuously advancing media time for a real catalog title, after separate access-code-entry authorization. | Authorized device evidence; blocked until authorization. |

## Safety and rollout

- No secrets, access codes, provider links, titles, or session tokens are logged, committed, or entered into a browser.
- `close`, rather than `exit`/`signalCode`, remains the sole capacity-release event. Process-group cleanup can target an exited leader only while the tracked child is not closed.
- Rollout remains branch → commit → canonical PR → exact-head green CI → merge → exact main deployment/verification. Railway is read only through its approved MCP in this slice.
- Rollback is a canonical revert PR; no direct main push or destructive infrastructure action.

## Verification log

- 2026-08-30: canonical remote, scoped SSH identity, required author, and tracked hooks were revalidated. A clean worktree and branch were created from exact `origin/main` `2a6cbd59` without reading or copying `.env.local`.
- 2026-08-30: P0 was reproduced by exact production CI and confirmed in sanitized Railway logs.
- 2026-08-30: red regressions reproduced the permanent signal-terminated HLS capacity slot, an immediately-completed duplicate stop while its child was still closing, a 429 when a subtitle freed the only available capacity slot during another stop, and a Next-episode retry that remained permanently disabled after an unconfirmed release.
- 2026-08-30: green focused evidence:
  - close-based HLS signal cleanup, owned descendant cleanup after leader exit, and duplicate-stop truthful 202/204 lifecycle behavior;
  - capacity admission succeeds when a subtitle closes during another session teardown;
  - gateway preserves the pending stop status and retry hint;
  - the player polls a pending release before issuing a replacement GET, aborts its bounded wait safely, and makes a failed Next-episode handoff retryable;
  - progressive and native-HLS test cleanup await the same confirmed-close contract;
  - control-only player UI tests fully route all debrid requests locally, with no provider calls in their focused executions.
- 2026-08-30: completed final local gates: lint, production build, all 365 unit tests, 110 passed cross-device smoke tests (19 intentionally skipped by project capability), and 5 passed WebKit keyboard tests. Independent read-only review found no blocking defect.
