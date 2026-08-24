# Task contract: Exit playback without reopening title details

## Classification and scope
- Type: BUG
- In scope: Make the player’s top-left `Back to browsing` control leave playback directly for the browsing page that opened the title.
- Out of scope: Playback decoding, stream selection, title-detail close behavior when opened normally, or visual redesign.
- Assumptions: “left UI” refers to the top-left arrow labeled `Back to browsing`; the expected result is the prior catalog/search page, not the title-details modal.

## Baseline evidence
- Revision/environment: `f1a88e1a6b255a6d3793b76e735ad1902276201b`, synchronized `origin/main` and production.
- User or client path: Open a title from search, start an episode, click the player’s top-left back arrow, then close the resulting details modal with X or its backdrop.
- Expected: The first click exits playback directly to the originating browsing page and playback does not reappear.
- Actual/missing: The first click returns to the title-details route, requiring a second dismissal and allowing playback to reappear through the duplicated route history.
- Evidence: User screenshots and a failing browser regression on the baseline.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | Clicking `Back to browsing` from a stream returns directly to the originating search/catalog page. | Playwright regression and normal-user verification | independent pass |
| AC-2 | No title-details dialog appears as an intermediate step after leaving playback. | Playwright dialog assertion | independent pass |
| AC-3 | Browser history remains coherent: leaving playback does not allow the dismissed player to reappear through the modal close path. | Browser navigation verification | independent pass |
| AC-4 | Playback remains healthy on laptop and phone after deployment. | Required production playback suite | pending |
| AC-5 | Exact merge commit is deployed with healthy required dependencies. | Main CI and production `/api/health` | pending |

## Risk and release
- Security/privacy/data risks: None; client-side navigation only.
- Compatibility/performance/accessibility risks: Low; preserve the existing accessible player button and title-detail behavior outside playback.
- Rollout: Standard PR to `main`, automatic Railway production deployment.
- Health signals and thresholds: Required CI green; production status `ok`; exact deployed commit; required dependencies healthy; laptop/phone real-catalog playback green.
- Rollback/disable path: Revert the merge through a new pull request if navigation history regresses.

## Verification log
- 2026-08-24, baseline `f1a88e1a`: route inspection confirms stream back targets the saved `debrid` detail route instead of its recorded browsing return path.
- 2026-08-24, focused unit regression RED: `playbackExitRoute` absent; baseline cannot select the recorded browsing path.
- 2026-08-24, focused unit regression GREEN (4/4): recorded search path wins over the detail-route fallback.
- 2026-08-24, focused laptop UI GREEN: back returns to `/search?q=heroes` with no dialog; revisiting and closing details through history leaves no player.
- 2026-08-24, full local gate GREEN: 146/146 tests, lint, production build, and 12/12 QA browser tests across phone and laptop.
- 2026-08-24, live-catalog candidate UI: Heroes S01E04 decoded and advanced to 0:05; `Back to browsing` returned directly to `/search?q=heroes` with zero player and zero dialog. Browser-back to Heroes details followed by X returned to search with zero player.
- 2026-08-24, independent verifier: AC-1/2/3 PASS on live Heroes S01E04. Playback advanced to 0:11; player back returned directly to search; both X and backdrop close paths left zero dialogs and zero videos. AC-4/5 remain post-deployment.
