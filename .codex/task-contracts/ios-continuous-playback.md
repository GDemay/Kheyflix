# Continuous iPhone Safari playback

## Acceptance criteria

- AC-1: iPhone Safari uses one standard HLS source and does not replace a short bootstrap playlist after playback starts.
- AC-2: Playback reaches a decoded frame and advances continuously for at least 20 seconds in the iOS Simulator after a user play gesture when required by Safari.
- AC-3: Phone Chromium and laptop production playback remain green.
- AC-4: Exact deployed commit is healthy and all required CI gates pass.

## Evidence

- RED: production `f43f0a10` on iOS 26.5 Simulator reached 0:01, paused during the bootstrap-to-standard source replacement, and repeatedly required a new user gesture. After a gesture it advanced to 0:46 and then 1:14 before pausing again.
- GREEN (local): the regression test proves iPhone playback never selects the bootstrap stream; the complete suite passes with 173 tests, plus lint and production build.
- REVIEW: independent verification passed; iPhone keeps one standard HLS source while desktop bootstrap playback remains unchanged.
- PRODUCTION: pending deployment of this branch and continuous Safari verification on the exact commit.
