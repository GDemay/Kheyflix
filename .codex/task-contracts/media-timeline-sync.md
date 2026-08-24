# Task contract: Preserve audio, video, and subtitle synchronization

## Classification and scope
- Type: BUG
- In scope: preserve source-relative media timestamps through direct, fragmented MP4, and HLS playback; keep text subtitle cues on the same seek-relative timeline; add deterministic packet/cue verification and real-catalog sampling; deliver through production.
- Out of scope: repairing source files whose audio or subtitle content is already incorrectly authored, image-based subtitle OCR, and claiming semantic lip-sync without a trusted reference signal in the source.
- Assumptions: the source container timestamps are authoritative, as they are for VLC; Kheyflix must not add measurable drift beyond one video frame or one encoded audio frame.

## Baseline evidence
- Revision/environment: `926e354d3db69bcf240853d9c74583b040ee3ad7`, local FFmpeg 8.0.1 and Railway production.
- User or client path: real catalog playback through `/api/debrid/stream`, `/api/debrid/hls`, and `/api/debrid/subtitle`.
- Expected: output audio/video start deltas preserve source deltas; subtitle cue times share the playback seek origin; no cumulative drift.
- Actual/missing: the transcoder applies no continuous timestamp reconciliation. On real catalog item `72935188/0`, source audio-minus-video start delta was `0.916583s`; production HLS emitted `0.978667s`, adding about `62ms`. The implementation has no automated packet-level or cue-level sync gate.
- Evidence: sanitized probes in `/tmp/kheyflix-baseline-probe.json` and `/tmp/kheyflix-hls-baseline.json`; reproducible commands will be committed as tests/scripts without catalog media.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Transcoded audio follows the source timeline from time zero and continuously compensates timestamp gaps/drift. | Deterministic FFmpeg fixture packet analysis plus option unit test. | pass |
| AC-2 | HLS and fragmented MP4 preserve source-relative audible/video content timing within one video frame or one AAC frame at start and after a seek. | Integration sync verifier with delayed audio, discontinuities, and a non-keyframe seek; sampled real catalog inputs. | pass |
| AC-3 | Text subtitle cues are rebased to the exact playback seek origin and remain aligned after seeking. | Deterministic WebVTT cue integration assertions. | pass |
| AC-4 | Existing neutral/manual audio correction behavior composes with automatic reconciliation without unsafe values. | Unit tests for generated FFmpeg filter chain. | pass |
| AC-5 | A real movie and real series decode and advance on laptop and iPhone paths after deployment, with packet-level sync sampling passing. | Independent verification, CI, production playback suite, and production verifier. | pass |

## Risk and release
- Security/privacy/data risks: never expose provider keys or unlocked upstream URLs; verification records only catalog IDs and timing metrics.
- Compatibility/performance/accessibility risks: FFmpeg audio resampling adds small CPU cost; preserve manual correction controls and all supported codecs.
- Rollout: pull request to `GDemay/Kheyflix` main, green CI, merge, wait for exact Railway commit.
- Health signals and thresholds: `/api/health` status `ok`, required dependencies healthy, A/V delta error no more than `max(video frame, AAC frame)` with a 10ms measurement allowance, no cumulative drift above that bound, playback continuously advances.
- Rollback/disable path: revert the merge commit through a pull request if sync, startup, or playback gates regress.

## Verification log
- 2026-08-24 baseline `926e354d`: real source `72935188/0` start delta `0.916583s`; production HLS delta `0.978667s`; approximately `62ms` added by the pipeline.
- 2026-08-24 RED: focused option test failed because neutral playback emitted no timestamp reconciliation filter.
- 2026-08-24 RED: subtitle option test failed because no timestamp-preserving seek/rebase contract existed; baseline FFmpeg command emitted an expired cue and placed the next cue three seconds late after a five-second seek.
- 2026-08-24 GREEN: focused option and FFmpeg integration tests passed (20/20); a deliberate 200ms audio packet gap was reduced to at most 22ms and a cue at source 7s became exactly 2s after a 5s seek.
- 2026-08-24 local quality: `npm test` 152/152, `npm run lint` pass, `npm run build` pass.
- 2026-08-24 independent candidate review `e9333da2`: FAIL. It reproduced a 300ms non-keyframe seek error caused by copied video and confirmed that an active subtitle cue was dropped by output seeking. AC-5 remained unverifiable before delivery.
- 2026-08-24 repair RED/GREEN: exact-seek mode now forbids video stream copy; a 5.3s non-keyframe integration seek starts decoded video and audio within 23ms. Subtitle extraction preserves source cue timestamps and a streaming WebVTT transform clips/rebases active and future cues; focused tests pass 24/24. Delayed audible content remains at 0.90–0.96s for a 0.916583s source offset while packet gaps remain at most 23ms.
- 2026-08-24 PR #45 CI RED: the GitHub runner lacked FFmpeg/FFprobe, so the media integration fixture could not be created. The test suite now carries pinned cross-platform media binaries as development dependencies; tests remain mandatory and do not skip when a host runtime is absent.
- 2026-08-24 production run `32760835117`: exact merge commit deployed and health/catalog verification passed; playback decoded and advanced on two paths, but the laptop quick-controls timeout failed three times because visibility could be enabled before React's playing state scheduled an auto-hide. Follow-up adds an effect that schedules hiding whenever controls and playback become concurrently active; the existing production regression passed five consecutive warm local runs.
- 2026-08-24 independent verification: AC-1 through AC-4 passed on the exact media candidate and the exact follow-up candidate. A gradual-drift fixture added 0.021ms onset error and 13ms end error over 30 seconds; fMP4/HLS non-keyframe seeks selected the requested frame and started A/V within 0–21.333ms; active subtitle cues were clipped and rebased exactly.
- 2026-08-24 production completion: PR #45 merged as `a651d9bb`; follow-up PR #48 merged as `7903c9b0`. Main run `32762279912` passed lint, 160 tests, build, exact-commit Railway wait, production verifier, and three real series playback checks. Production `/api/health` reported exact commit `7903c9b0`, status `ok`, and healthy AllDebrid/discovery/transcoder dependencies; verifier found 684 catalog records, 445 ready records, and 3,628 video files.
- 2026-08-24 real movie completion: catalog movie `72935188/0` decoded at 1920×816 and advanced continuously by more than five seconds on laptop and iPhone profiles; first decoded frames in the full player runs were 2.311s and 1.570s. A production HLS packet sample measured 21.333ms between first audio/video packets. No rollback was required.
