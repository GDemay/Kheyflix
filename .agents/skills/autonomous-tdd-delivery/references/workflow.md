# Evidence-gated workflow

## 0. Ground and activate the delivery goal

Read repository instructions and confirm the authorized remote. Then make synchronization with the latest authoritative `main` the first Git operation: from a clean local `main`, run `git pull --ff-only <remote> main`. When repository or worktree constraints prevent checking out local `main`, fetch the authorized remote's `main` and treat the fetched commit as the baseline. Do not create the delivery branch yet, merge `main` into an existing feature branch as a substitute, or disturb uncommitted work.

From that synchronized, untouched baseline, gather the complete available task authority before setting the goal: the user's original request and follow-ups; repository and directory instructions; linked issues, specifications, designs, decision records, and documentation; relevant code contracts and current behavior; test commands and quality gates; CI/CD and branch protections; deployment, observability, and rollback guidance; and authorization, secret, data, security, compatibility, accessibility, and production constraints. Follow explicit source precedence and resolve contradictions in favor of higher-authority instructions. Do not invent missing product scope. Record material ambiguity as an assumption only when the smallest reversible interpretation is safe; otherwise stop for the required decision.

Synthesize and activate exactly one durable delivery goal using the native goal tool when available or `/goal <objective>`. Do this before creating a branch, editing files, starting implementation, or making any further project or external mutation beyond the required baseline synchronization. A plan, task contract, checklist, or progress message does not replace the goal.

The goal objective must be outcome-focused and concise while covering:

- one user-visible or public-contract outcome and one verifiable stopping condition;
- the authoritative files, documentation, issue/design sources, and baseline revision it is grounded in;
- in-scope work, explicit non-goals, and preserved behavior;
- acceptance criteria and the commands, user paths, artifacts, revisions, health signals, and independent evidence that prove them;
- repository rules, permissions, secrets, safety, compatibility, accessibility, and side-effect constraints;
- whether branch, pull request, merge, deployment, production verification, and rollback are in scope and authorized;
- checkpoint reporting and the exact conditions for retrying, blocking, rolling back, or stopping.

Use this adaptable shape rather than copying it mechanically:

```text
Complete <single durable outcome>, grounded in <authoritative requirements and baseline>, without changing <non-goals/preserved behavior>. Prove completion with <acceptance evidence and user-path checks>, obey <constraints and authorization boundaries>, deliver through <authorized release scope>, report at <checkpoints>, and stop only when <verifiable end state> or <named blocked/rollback condition> is reached.
```

Inspect an existing goal before creating one. Continue it only when it already represents this same delivery objective and requirements; never silently replace an unrelated unfinished goal. If native goal support is unavailable, use the bounded Codex Cloud repository-backed fallback defined in `SKILL.md` only when all of its conditions hold. Otherwise stop with `BLOCKED_GOAL_UNAVAILABLE`. If another unfinished goal conflicts, stop with `BLOCKED_GOAL_CONFLICT`.

## 1. Establish scope and baseline

With the goal active, create the delivery branch directly from the synchronized authoritative `main` commit. Record that commit as the untouched baseline and confirm the repository and target environment before any external mutation.

Normalize the input as `BUG`, `FEATURE`, or `MIXED`. For mixed work, separate criteria and apply each gate independently.

For a bug, reproduce on the untouched baseline using the shortest realistic path. Capture inputs, environment/revision, exact actions, expected result, actual result, and durable evidence such as a failing test, trace, sanitized log excerpt, API response, or browser recording. Check that the failure is the reported defect rather than broken setup. If it cannot be reproduced, do not make a speculative product fix. Limit work to diagnosis and non-behavior-changing evidence gathering.

For a feature, inspect the normal user journey and capture baseline evidence showing where the capability is missing. For backend-only work, use the public API, CLI, protocol, job output, or externally observable state with production-like permissions.

## 2. Write the task contract

Create a durable Markdown file in the repository's established planning location. If none exists, use `.codex/task-contracts/<task-slug>.md`; keep it untracked only when repository policy disfavors task artifacts. Update it throughout the run.

Include:

```markdown
# Task contract: <title>

## Goal alignment
- Active goal objective:
- Authoritative inputs:
- Verifiable stopping condition:
- Goal/task-contract differences: none | <resolved difference>

## Classification and scope
- Type: BUG | FEATURE | MIXED
- In scope:
- Out of scope:
- Assumptions:

## Baseline evidence
- Revision/environment:
- User or client path:
- Expected:
- Actual/missing:
- Evidence:

## Acceptance criteria
| ID | Observable requirement | Test/evidence | Status |
|---|---|---|---|
| AC-1 | ... | ... | pending |

## Risk and release
- Security/privacy/data risks:
- Compatibility/performance/accessibility risks:
- Rollout:
- Health signals and thresholds:
- Rollback/disable path:

## Verification log
- <timestamp, revision, command/path, result, artifact>
```

Make acceptance criteria observable, unambiguous, and bounded. Add relevant negative cases, permissions, accessibility, error behavior, compatibility, migration, and rollback expectations without inventing unrelated product scope. Resolve ambiguity using the smallest reversible behavior consistent with the request and record the assumption.

Reconcile the contract against the active goal before implementation. The contract may add traceability detail, but it must not silently narrow, broaden, or contradict the goal. If new authoritative information materially changes the objective or stopping condition, pause project mutations and replace the goal through the supported goal controls before continuing. Do not treat an accumulating checklist or unrelated backlog as one goal.

## 3. Plan by vertical slices

Plan the smallest end-to-end slices that each produce user-visible or contract-visible value. For each slice identify the failing test, implementation surface, user-path check, and risks. Prefer a few high-signal tests over maximizing test count or coverage percentage. Do not begin implementation before the contract and first test target exist.

## 4. Execute red-green-refactor

For each slice:

1. Add or modify a test that expresses the next acceptance behavior at the lowest reliable layer. Include integration or end-to-end coverage when unit tests cannot prove the user contract.
2. Run it on the baseline and confirm `RED`: it fails for the expected missing or defective behavior, not syntax, fixtures, environment, or unrelated failures. Record the command and failure.
3. Implement the smallest coherent change that makes it pass.
4. Run the focused test and confirm `GREEN`.
5. Refactor without changing behavior, rerunning relevant tests.
6. Exercise the normal user/client path and record evidence.
7. Update the contract traceability row.

Tests should assert observable outcomes, remain isolated and deterministic, and use user-facing selectors or public contracts. Mock external systems only at owned boundaries; retain at least one realistic integration path when feasible. A change with no practical executable test must document why and add the nearest automated validation before implementation.

## 5. Local quality gate

Before independent verification, run all project-required checks for the exact working revision: focused tests, affected suites, full test suite where feasible, lint/static analysis, type checks, build/package, migrations or schema validation, security/dependency checks already required by the project, and an end-to-end smoke path. Do not silently ignore flaky or unrelated failures; classify and record them.

Re-read the task contract criterion by criterion. Any missing evidence returns to the relevant red-green-refactor slice.

## 6. Independent acceptance gate

Use a fresh verifier with no implementation conversation. Provide the original requirement, task contract, baseline and candidate revision identifiers, safe startup/access instructions and test data, and the runnable application or public interface.

Ask it to independently navigate as a normal user/client, test every criterion including meaningful negative paths, inspect only what is needed to explain failures, and return a criterion-level `PASS`, `FAIL`, or `UNVERIFIABLE` with artifacts. It must not edit code.

Any `FAIL` returns to implementation and the full relevant gates. Any `UNVERIFIABLE` requires repairing the environment/evidence; it is not a pass. Reuse the same verifier identity when practical for production comparison, but start a fresh verification turn with the deployed revision and no implementer conclusions.

## 7. Pull request and CI gate

Review the diff for scope, secrets, generated noise, compatibility, migrations, and rollback safety. Commit and push only to the authorized repository. Open a focused pull request linking the task contract and evidence. Never self-approve where policy requires independent approval.

Wait for all required checks on the exact head commit. If code changes after a pass, invalidate the pass and wait again. Diagnose CI failures, reproduce locally when possible, repair through tests, and repeat. Merge only when required checks and protections pass.

## 8. Deployment and production gate

Confirm which immutable commit/artifact is deployed. Prefer feature flags, canary, or staged rollout for meaningful risk. Define health thresholds before rollout and compare candidate signals with control/baseline where infrastructure supports it. Observe errors, latency, saturation, critical business transactions, and relevant logs for a bounded bake window appropriate to the system.

Run production-safe acceptance checks through the normal interface with non-destructive test data. Do not run destructive test suites against production. Verify every criterion that can safely be exercised and compare the results with local/staging evidence.

If acceptance or health thresholds fail:

1. Stop promotion.
2. Roll back or disable the feature when the pre-authorized safe mechanism exists.
3. Verify recovery.
4. Reproduce the production-only failure in a safe environment, add a failing regression test, repair, and repeat from the relevant gate.

If rollback is unavailable, risky, or unauthorized, stop with `BLOCKED_UNSAFE_PRODUCTION` and report impact and containment evidence. Do not improvise a destructive recovery.

## 9. Final record

Report the active goal and stopping-condition evidence, classification, baseline proof, acceptance traceability, tests and quality checks, independent verdict, pull request and merged revision, deployed revision/environment, production evidence and health window, rollback status, and residual risk. Completion requires evidence for the deployed artifact, not merely a green development branch. Mark the goal complete only when the stopping condition and every required contract criterion are proven; when genuinely blocked, preserve the evidence and use the supported blocked state instead of claiming completion.
