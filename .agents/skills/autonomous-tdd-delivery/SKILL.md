---
name: autonomous-tdd-delivery
description: Autonomously deliver a software bug fix or feature from requirement through production using evidence gates, test-first development, user-visible verification, independent review, CI, rollout, and post-deployment checks. Use when the user requests an end-to-end implementation with no routine human checkpoint; do not use for advice-only, diagnosis-only, or review-only work.
---

# Autonomous TDD Delivery

Turn the requirement into auditable evidence, not just code. Read [references/workflow.md](references/workflow.md) before changing the project.

## Non-negotiable gates

- Establish an active `/goal` as an opening delivery gate. After synchronizing the authoritative baseline and reading the original request plus all applicable repository instructions, issue or design sources, project documentation, architecture, tests, CI/CD, deployment, observability, and rollback guidance, synthesize one durable objective and one verifiable stopping condition. Create the goal before creating the delivery branch, editing files, or making any further project or external mutation beyond the required baseline synchronization. The goal must identify the authoritative inputs, in-scope outcome and explicit non-goals, acceptance evidence, constraints and permissions, delivery scope, checkpoints, and blocked/stop conditions. Use the native goal tool when available or `/goal <objective>`; do not substitute a plan, task contract, or commentary message. If an unrelated unfinished goal already exists, or goal support cannot be used, stop with `BLOCKED_GOAL_CONFLICT` or `BLOCKED_GOAL_UNAVAILABLE` rather than overwriting or bypassing it.
- Make the first Git operation a synchronization with the latest authoritative `main`. After reading repository instructions and confirming the authorized remote, update local `main` with `git pull --ff-only <remote> main` before creating the delivery branch. If `main` cannot be checked out safely (for example, in a linked worktree), fetch that remote's `main` and create the branch directly from the fetched `main` commit instead. Never merge `main` into an existing feature branch as a substitute, and never overwrite uncommitted work.
- Preserve repository instructions, authorization boundaries, secrets, protected branches, and deployment controls. “Autonomous” removes routine confirmation; it does not grant missing access or permission.
- For a reported bug, do not implement a fix until the failure is reproduced from the current baseline. A deterministic failing automated test is preferred; a recorded user-path reproduction is acceptable initially. If reproduction cannot be established, investigate without changing product behavior, then report `BLOCKED_NOT_REPRODUCED` with evidence and stop.
- For a feature, establish baseline evidence that the requested capability is absent or insufficient through the user-facing interface or, for headless systems, the public API/CLI/observable contract.
- Write and preserve a task contract before implementation. Every acceptance criterion must map to evidence.
- Add the smallest meaningful failing test first and confirm it fails for the intended reason. Then implement and refactor. Do not write implementation and retroactively label tests as TDD.
- Validate through the same interface and permissions a normal user or client uses. Do not treat internal state, mocks, screenshots alone, or code inspection as proof of working behavior.
- Require an independent, clean-context verifier before merge. When subagents are available, spawn one with only the original requirement, task contract, runnable target, and verification instructions—not the implementation rationale or expected verdict. The implementer owns every repair loop; the verifier only judges and reports.
- Never weaken, skip, delete, or rewrite a valid test, acceptance criterion, quality gate, or production safeguard merely to obtain a pass.
- Merge and deploy only when explicitly in scope and authorized. Verify the deployed revision, production behavior, and health signals. Roll back or disable the change automatically on a defined harmful regression when a safe rollback path is authorized.
- Avoid infinite loops. After three materially different failed repair attempts at the same gate, stop with `BLOCKED_RETRY_LIMIT`, preserving artifacts and the precise unresolved evidence.

## Codex Cloud goal fallback

Use native goal support whenever the task runtime exposes it. In Codex Cloud only, when neither the native goal tool nor the `/goal` command is executable by the agent, activate a repository-backed goal record at `.codex/goals/active.md` instead of stopping with `BLOCKED_GOAL_UNAVAILABLE`.

The fallback is valid only when all of these conditions hold:

- the task is running in a repository-scoped Codex Cloud checkout;
- native goal support was checked and is unavailable;
- no unrelated active fallback goal exists;
- the record contains the same objective, authoritative inputs, scope, evidence, permissions, stopping conditions, and status required of a native goal;
- the record is created before the delivery branch or implementation changes, except for the required authoritative baseline synchronization;
- every status transition and final result updates the record; and
- the task contract links to the fallback record and notes that native goal support was unavailable.

Treat the fallback record as workflow state, not product code. Preserve it as delivery evidence unless repository policy requires task artifacts to remain untracked. If the record cannot be created safely, an unrelated active record exists, or the runtime is not Codex Cloud, stop with `BLOCKED_GOAL_UNAVAILABLE` or `BLOCKED_GOAL_CONFLICT` as applicable. Never claim that merely writing `/goal` in prose activated a goal.

## Completion definition

Declare success only when the active goal's stopping condition and the task contract are fully traced to passing local and independent evidence, required CI is green for the exact revision, that revision is merged and deployed when in scope, and production verification plus health checks pass. Mark the goal complete only after every required outcome is proven; do not mark an incomplete or merely budget-limited run complete. Otherwise return the appropriate blocked or failed state; never convert uncertainty into success.
