# Task contract: Cloud autonomous TDD delivery skill

## Goal alignment
- Active goal objective: Make the user-provided `autonomous-tdd-delivery` skill discoverable and usable in fresh Codex Cloud tasks for Kheyflix, then deliver and verify it through the repository workflow.
- Authoritative inputs: User request; supplied `SKILL.md` and `references/workflow.md`; repository `AGENTS.md`; `origin/main` revision `5629845f7c1cfd4510dcf0f6a0b0b61ec483cc22`; current Codex skill packaging behavior.
- Verifiable stopping condition: The repository-scoped skill is merged to `main`, exact-revision CI is green, and a fresh Codex Cloud task invokes `$autonomous-tdd-delivery`, identifies the repository skill, and activates its first delivery gate without changing product code.
- Goal/task-contract differences: none.

## Classification and scope
- Type: FEATURE
- In scope: Repository-scoped skill packaging, a Cloud-compatible durable-goal fallback when native goal support is unavailable, automated structural policy coverage, cloud-environment maintenance needed for repository safeguards, PR/CI/merge, and fresh-cloud verification.
- Out of scope: Kheyflix product behavior, unrelated dependencies, playback behavior, and production application deployment changes.
- Assumptions: Codex Cloud discovers repository skills under `.agents/skills`; native goals may be unavailable in Cloud, so a narrowly documented repository goal record is permitted only as the skill's Cloud fallback.

## Baseline evidence
- Revision/environment: `5629845f7c1cfd4510dcf0f6a0b0b61ec483cc22`, clean isolated worktree from `origin/main`.
- User or client path: Start a fresh Kheyflix Codex Cloud task and invoke `$autonomous-tdd-delivery`.
- Expected: Codex discovers the skill and begins its evidence-gated workflow.
- Actual/missing: No `.agents/skills/autonomous-tdd-delivery/SKILL.md` exists in the repository; only the user's Mac-local copy exists.
- Evidence: Repository file inventory and the failing repository-skill policy test.

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | A fresh clone contains the complete skill and workflow reference in the standard repository skill location. | `scripts/autonomous-tdd-skill-policy.test.ts` | passed locally |
| AC-2 | The skill retains its evidence gates and defines a bounded Cloud-compatible goal fallback without silently replacing native goals. | Policy test plus independent review | passed locally |
| AC-3 | Existing lint, unit, and build gates pass without product behavior changes. | `npm run lint`, `npm test`, `npm run build` | passed locally |
| AC-4 | The change is delivered through a canonical Kheyflix PR with green exact-revision CI. | PR and GitHub Actions evidence | pending |
| AC-5 | A fresh Codex Cloud task recognizes `$autonomous-tdd-delivery` and activates the opening gate without modifying product code. | Cloud task transcript and clean Git status | pending |

## Risk and release
- Security/privacy/data risks: The skill must not contain secrets or weaken repository authorization boundaries.
- Compatibility/performance/accessibility risks: Documentation-only runtime impact; discovery depends on the repository skill path supported by Codex.
- Rollout: Merge through the canonical pull request after green CI, then validate in a fresh Cloud task.
- Health signals and thresholds: Policy test, full CI, exact merged revision, skill discovery, correct first gate, and clean Cloud worktree.
- Rollback/disable path: Revert the skill-only pull request if repository discovery causes unintended behavior.

## Verification log
- 2026-08-25, `5629845f7c1cfd4510dcf0f6a0b0b61ec483cc22`: repository skill directory absent; feature baseline established.
- 2026-08-25, focused policy test RED: failed because `.agents/skills/autonomous-tdd-delivery/SKILL.md` was absent.
- 2026-08-25, focused policy test GREEN: 1 test passed after adding the repository bundle and bounded Cloud goal fallback.
- 2026-08-25, `quick_validate.py`: skill frontmatter, name, and structure valid.
- 2026-08-25, local quality gate: lint passed; 32 test files and 188 tests passed; Vinext production build passed.
- 2026-08-25, independent clean-context review: AC-1, AC-2, and AC-3 PASS; no credentials, forbidden access instructions, or product-code changes found. AC-4 remained undelivered and AC-5 required Cloud evidence.
