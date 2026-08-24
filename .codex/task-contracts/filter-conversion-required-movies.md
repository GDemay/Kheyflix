# Task contract: Filter conversion-required movies

## Classification and scope
- Type: MIXED
- In scope: diagnose magnet `701203990` file `0`; remove movie files with non-direct-play containers from the library; suppress discovery releases that explicitly advertise conversion-required video; prevent a prepared discovery movie with only incompatible files from becoming watchable.
- Out of scope: removing series, deleting existing AllDebrid magnets, or changing the transcoder.
- Assumptions: “wrong format” means a movie that cannot use Kheyflix's direct browser playback path. MP4/M4V movie files remain eligible; Matroska/WebM/AVI/MOV/TS/M2TS files require compatibility processing and are excluded. Discovery titles can only be filtered from advertised metadata until the magnet's files are available.

## Baseline evidence
- Revision/environment: synchronized `origin/main`; local app at `http://localhost:3000` on 2026-08-24.
- User or client path: `/stream/701203990/0/star-wars-the-mandalorian-and-grogu-2026-internal`.
- Expected: direct, promptly starting playback or exclusion from direct-play movie choices.
- Actual/missing: probe reports `matroska,webm`, HEVC 1080p video and AAC audio; compatibility transcode is required. Direct stream and transcoder both return 200. The laptop live-playback test currently advances successfully in 9.8 seconds, so the reported startup failure is not currently deterministic; conversion requirement is reproduced.
- Evidence: `GET /api/debrid/media/701203990/0`; `HEAD /api/debrid/stream/701203990/0`; `tests/ui/live-loader.spec.ts` against the supplied path.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Movie catalog omits files whose container requires compatibility processing. | `app/lib/media-parser.test.ts` | passing |
| AC-2 | Series behavior is unchanged by the movie-only rule. | `app/lib/media-parser.test.ts` | passing |
| AC-3 | Discovery omits releases explicitly marked with incompatible video codecs or containers. | `app/lib/prowlarr.test.ts`; live discovery API returned no Mandalorian HEVC result | passing |
| AC-4 | A prepared movie with no direct-play file never offers Watch and explains why. | `tests/ui/discovery-compatibility.spec.ts` on phone and laptop | passing |
| AC-5 | Existing direct-play MP4/H.264 movies remain available. | media-parser and Prowlarr unit tests | passing |

## Risk and release
- Security/privacy/data risks: no secret or magnet deletion; filtering only.
- Compatibility/performance/accessibility risks: metadata is incomplete before preparation, so unknown releases remain searchable and are validated after their file list appears. Preserve an accessible status explanation.
- Rollout: normal pull request and production deployment.
- Health signals and thresholds: required CI green; `/api/health` exact merge commit and dependencies healthy; production playback tests pass on laptop and iPhone profiles using real catalog content.
- Rollback/disable path: revert the merge commit through the normal pull-request workflow if eligible direct-play movies disappear unexpectedly.

## Verification log
- 2026-08-24, baseline, supplied stream: direct HEAD 200; probe 200 (`matroska,webm`, HEVC); 480p transcode produced MP4 bytes for 20 seconds.
- 2026-08-24, baseline, laptop live loader: PASS, continuously advancing stream; reported intermittent failure not reproduced in this run.
- 2026-08-24, RED: focused media-parser and Prowlarr tests failed because MKV/HEVC results remained eligible.
- 2026-08-24, candidate: 24 focused tests, 138 full unit tests, lint, and production build passed.
- 2026-08-24, candidate: prepared incompatible-movie UI test passed on phone and laptop profiles.
- 2026-08-24, candidate: supplied live title decoded and advanced on laptop and phone profiles, confirming that its current path works but requires compatibility conversion.
- 2026-08-24, independent verification: PASS for AC-1 through AC-5; supplied path advanced on phone (6.8s test) and laptop (9.2s test). Live Prowlarr corroboration was unavailable due to `PROWLARR_ERROR`; deterministic provider-boundary coverage passed.
