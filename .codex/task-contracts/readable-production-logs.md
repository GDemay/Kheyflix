# Readable production logs and playback startup

## Acceptance criteria

- AC-1: One API action produces one concise, human-readable summary log, not duplicated generic/domain completion lines.
- AC-2: Routine logs lead with a plain-language `message` and keep correlation, status, duration, event, and error code for filtering.
- AC-3: Transcoder health checks never probe an intentionally invalid media URL or emit `INVALID_MEDIA` noise.
- AC-4: Playback startup does not wait for a duplicate AllDebrid `HEAD` request before loading the real stream.
- AC-5: Expected client errors are warnings without production stack noise; unexpected server failures retain useful sanitized diagnostics.
- AC-6: Unit, lint, build, production health, and real-catalog phone/laptop playback gates pass for the exact deployed commit.

## Verification evidence

- RED: focused observability tests proved duplicate debrid completion lines, missing human messages, and an invalid-media transcoder health probe. Production playback run `32776254551` also failed on slow/stalled Smiling Friends playback.
- GREEN: 172/172 unit/integration tests, lint, build, dependency audit (zero production vulnerabilities), and diff check pass.
- Browser: provider outage and retry pass on phone/tablet/laptop (3/3). Real live-catalog Shrek playback decoded and continuously advanced on phone (first frame 3974 ms) and laptop (2789 ms), with no blocking stream `HEAD`.
- Independent review: initial review caught missing completion fields on domain logs; after pending-context enrichment, the independent probe confirmed exactly one line with message, request ID, method, route, status, duration, result count/error code. Focused suite passes 13/13 and final review is PASS.
