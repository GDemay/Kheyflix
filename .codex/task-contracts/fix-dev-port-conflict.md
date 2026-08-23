# Task contract: Start local development when port 3101 is occupied

## Classification and scope
- Type: BUG
- In scope: Make `npm run dev` keep the public app on port 3000, reuse an already-running healthy Kheyflix transcoder, and select a free internal port only when 3101 belongs to another service.
- Out of scope: Dependency upgrades, production port allocation, playback behavior, and the user's unrelated working-tree changes.
- Assumptions: An explicitly configured `KHEYFLIX_TRANSCODER_PORT` is intentional and must not be silently changed.

## Baseline evidence
- Revision/environment: `be91717bb980790eab530d365c09fb3cd177819b`, macOS, Node 25.8.2.
- User or client path: Run `npm run dev` while another Kheyflix transcoder listens on 127.0.0.1:3101.
- Expected: Kheyflix starts and remains available on port 3000 without manual process cleanup.
- Actual/missing: The transcoder emits an unhandled `EADDRINUSE` error and the launcher terminates.
- Evidence: User transcript and `lsof` showing PID 4286 (`node scripts/transcoder.mjs`) listening on 127.0.0.1:3101.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | With a healthy Kheyflix transcoder on 3101, the launcher reuses it and does not spawn or stop it. | Focused automated service-detection test and `npm run dev` smoke test | passed |
| AC-2 | If a healthy Kheyflix app is already on port 3000, `npm run dev` reports it and exits successfully without starting a duplicate on 3001. | Focused automated service-detection test and real launcher smoke test | passed |
| AC-3 | An explicit `KHEYFLIX_TRANSCODER_PORT` remains authoritative. | Focused automated test | passed |
| AC-4 | If 3101 is occupied by another service, the launcher selects a different free loopback port without killing the existing process. | Focused automated port-selection test | passed |
| AC-5 | Child startup failures are reported and launcher-owned sibling processes are stopped. | Focused automated test/code-path review | passed |

## Risk and release
- Security/privacy/data risks: Bind only to loopback; never expose or log `.env.local` secrets.
- Compatibility/performance/accessibility risks: Very small startup-only port probe; no user-interface changes.
- Rollout: Pull request to `GDemay/Kheyflix` main after local and CI verification.
- Health signals and thresholds: Development app and `/api/health` respond successfully; required CI is green.
- Rollback/disable path: Revert the launcher commit through a pull request.

## Verification log
- 2026-08-23, baseline `be91717b`, user `npm run dev`: failed with `EADDRINUSE` on 127.0.0.1:3101.
- 2026-08-23, local smoke: PID 4287 already served healthy Kheyflix `/api/health` on localhost:3000 and PID 4286 served its transcoder on 3101; the baseline launcher nevertheless started a duplicate app on 3001.
- 2026-08-23, focused test: 4 launcher regression tests passed.
- 2026-08-23, normal user path: `npm run dev` exited 0 with `Kheyflix is already running at http://localhost:3000. Nothing else to start.`; existing PIDs remained running.
- 2026-08-23, local quality: ESLint passed; 23 files / 134 unit tests passed; production build passed.
