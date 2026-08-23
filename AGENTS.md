# Kheyflix repository boundary

- The only authorized GitHub repository for this project is `GDemay/Kheyflix`.
- Git operations for this repository must use the repository-scoped SSH identity at `/Users/gdemay/.ssh/kheyflix_orchestrator`, which authenticates to GitHub as `GDemay/Kheyflix`. The repository-local `core.sshCommand` must keep `IdentitiesOnly=yes` so the global `guillaume-tesla` identity cannot be selected first.
- Every commit must use `GDemay <7033942+GDemay@users.noreply.github.com>`. The tracked `.githooks/pre-commit` guard must remain enabled through `core.hooksPath=.githooks`; never bypass it.
- The canonical ignored local runtime environment is `/Users/gdemay/Documents/Projects/Kheyflix/.env.local`. It contains the server-side `ALLDEBRID_API_KEY`, `PROWLARR_URL`, and `PROWLARR_API_KEY` and must remain mode `0600`, untracked, and never printed, pasted into chat, committed, or exposed to browser code. A new worktree must copy that file to its own project-root `.env.local` before running or testing discovery or AllDebrid integration. Keep `.env.example` limited to placeholder values.
- Treat the remote named `origin` as authoritative and require both its fetch and push URL to be exactly `git@github.com:GDemay/Kheyflix.git` before pushing, opening a pull request, merging, deploying, or dispatching repository work. HTTPS remotes are forbidden because they can bypass the repository-scoped SSH identity.
- Never push Kheyflix code, branches, tags, releases, or pull requests to a fork or to any repository owned by another account, including `guillaume-tesla/Kheyflix`.
- All pull requests must target `GDemay/Kheyflix`, normally its `main` branch unless the user explicitly names another base branch.
- If authentication cannot write to `GDemay/Kheyflix`, stop and report the authentication problem. Do not use a fork as a fallback.
- Before handing off work, confirm that the commit is present on `GDemay/Kheyflix` and report the canonical PR or commit URL.
- Do not bypass, disable, or replace the tracked `.githooks/pre-push` repository/account guard.
- Never invoke `gh` directly in this repository. Every GitHub API operation must run through `npm run github -- <gh arguments>`. The gateway allows only repository-scoped delivery commands (`pr`, `run`, `workflow`, `release`, `issue`, and `label`), uses the isolated profile at `~/.config/gh-kheyflix`, removes ambient `GH_TOKEN`/`GITHUB_TOKEN`, injects `--repo GDemay/Kheyflix`, verifies the API login is exactly `GDemay`, verifies the exact SSH `origin`, rejects all caller-supplied repository selectors, blocks raw `api`/`graphql` and general `repo` commands, and invokes GitHub CLI only from fixed system paths. If it reports that the isolated profile is unauthenticated, run `npm run github:setup` once and authenticate as `GDemay`; never fall back to the global `gh` profile.

## Required delivery workflow

- Before changing code, fetch `origin/main`, create an `originator/*` branch from it, and confirm both the repository URL and the exact `GDemay <7033942+GDemay@users.noreply.github.com>` commit identity. If either check fails, repair it before continuing.
- Never push directly to `main`. Every code, configuration, workflow, or documentation change must be committed on a branch, pushed to `GDemay/Kheyflix`, and delivered through a pull request targeting `main`.
- Open and merge pull requests as the GitHub user `GDemay` through `npm run github -- ...`. If the isolated profile cannot authenticate as `GDemay`, stop; never use direct `gh`, the global CLI profile, a fork, or another account as a workaround.
- Before opening the pull request, run the relevant local lint, unit, integration, build, and playback tests. Add regression coverage for every bug fix. Do not weaken, skip, or remove tests to obtain a pass.
- After opening the pull request, inspect every CI check and its logs. Fix failures on the same branch and repeat until all required PR checks pass. Never merge a red or pending pull request.
- Merge only through the pull request. Then wait for the `main` CI/CD run associated with the exact merge commit; a successful run for an older commit is not evidence that the current change deployed.
- Confirm production `/api/health` reports the exact merge commit and healthy required dependencies. Run the production verifier and the real playback test suite after deployment.
- For playback changes, verify a first decoded frame followed by continuously advancing playback on both laptop and iPhone Safari (a real device when available, otherwise the iOS simulator). A rendered player, advancing controls, or a playlist response alone is not sufficient.
- Treat external-provider failures, missing secrets, wrong deployed commits, skipped checks, and flaky playback as blockers. Do not report completion, merge success, or a healthy deployment until the full loop is green. Record the exact blocker and continue automatically once it is resolved.
- Before handoff, confirm the canonical PR URL, merge commit on `GDemay/Kheyflix`, green CI/CD for that commit, exact production commit, and measured laptop/iPhone playback results.

## Playback fixture prohibition

- Never add, launch, autoplay, test, or use Big Buck Bunny or another demo/open movie as Kheyflix playback evidence.
- Loader, playback, audio, and deployment verification must use a real title from the live streaming catalog and its production playback path.
