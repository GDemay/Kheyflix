# Kheyflix repository boundary

- The only authorized GitHub repository for this project is `GDemay/Kheyflix`.
- Git operations for this repository must use the repository-scoped SSH identity at `/Users/gdemay/.ssh/kheyflix_orchestrator`, which authenticates to GitHub as `GDemay/Kheyflix`. The repository-local `core.sshCommand` must keep `IdentitiesOnly=yes` so the global `guillaume-tesla` identity cannot be selected first.
- The canonical ignored local runtime environment is `/Users/gdemay/Documents/Projects/Kheyflix/.env.local`. It contains the server-side `ALLDEBRID_API_KEY`, `PROWLARR_URL`, and `PROWLARR_API_KEY` and must remain mode `0600`, untracked, and never printed, pasted into chat, committed, or exposed to browser code. A new worktree must copy that file to its own project-root `.env.local` before running or testing discovery or AllDebrid integration. Keep `.env.example` limited to placeholder values.
- Treat the remote named `origin` as authoritative and verify that its fetch and push URL is `git@github.com:GDemay/Kheyflix.git` (or the HTTPS equivalent) before pushing, opening a pull request, merging, deploying, or dispatching repository work.
- Never push Kheyflix code, branches, tags, releases, or pull requests to a fork or to any repository owned by another account, including `guillaume-tesla/Kheyflix`.
- All pull requests must target `GDemay/Kheyflix`, normally its `main` branch unless the user explicitly names another base branch.
- If authentication cannot write to `GDemay/Kheyflix`, stop and report the authentication problem. Do not use a fork as a fallback.
- Before handing off work, confirm that the commit is present on `GDemay/Kheyflix` and report the canonical PR or commit URL.
- Do not bypass, disable, or replace the tracked `.githooks/pre-push` repository/account guard.

# Delivery contract

- For every implementation or bug-fix request, create a goal whose objective is the requested behavior working in production. Keep working until it is complete or a concrete blocker is reported.
- Before coding, derive observable acceptance criteria from the request. Prefer the smallest maintainable change; follow existing patterns, preserve compatibility, accessibility, security, and server-only secrets.
- Add or update regression tests for changed behavior. Required gates are `npm test`, `npm run lint`, and `npm run build`; do not weaken, skip, or delete tests to pass a gate.

# Independent review loop

- After implementation, spawn one independent reviewer agent. Give it the original request and acceptance criteria, but do not coach it toward approval.
- The reviewer must inspect the actual diff and run relevant tests. For user-visible behavior, it must exercise the real workflow in a browser and capture screenshots that prove the acceptance criteria; mocked or static-page evidence is insufficient.
- The reviewer returns `PASS` only when every requirement is demonstrably implemented. Otherwise it returns `FAIL` with concrete evidence and required fixes.
- On `FAIL`, the implementing agent fixes the findings and sends the result back to the reviewer. Repeat until `PASS`; the implementing agent may not approve its own work.
- Include the final reviewer verdict, commands run, and screenshot evidence in the user-facing conversation. Never place secrets or private data in screenshots or logs.

# Ship only after proof

- After reviewer `PASS` and all gates pass, create a branch using the `originator/` prefix, commit, push, and open a non-draft PR against `GDemay/Kheyflix:main`.
- Merge only when required GitHub checks pass and the PR is mergeable. Never bypass branch protection, approvals, repository guards, or failing checks.
- After merge, deploy the merged `main` commit to production using the repository's documented Railway workflow. Verify `/api/health` and re-run the reviewed user workflow against production, capturing final screenshot evidence.
- If PR creation, merge, deployment, or production verification lacks credentials, tooling, or authorization, stop at that gate and report the exact blocker. Never claim success from a local run alone.
- Mark the goal complete only after production verification, then report the canonical PR, merge commit, deployment result, tests, reviewer verdict, and screenshots.
