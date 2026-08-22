# Kheyflix repository boundary

- The only authorized GitHub repository for this project is `GDemay/Kheyflix`.
- Git operations for this repository must use the repository-scoped SSH identity at `/Users/gdemay/.ssh/kheyflix_orchestrator`, which authenticates to GitHub as `GDemay/Kheyflix`. The repository-local `core.sshCommand` must keep `IdentitiesOnly=yes` so the global `guillaume-tesla` identity cannot be selected first.
- The canonical ignored local runtime environment is `/Users/gdemay/Documents/Projects/Kheyflix/.env.local`. It contains the server-side `ALLDEBRID_API_KEY` and must remain mode `0600`, untracked, and never printed, pasted into chat, committed, or exposed to browser code. A new worktree must copy that file to its own project-root `.env.local` before running or testing AllDebrid integration. Keep `.env.example` limited to placeholder values.
- Treat the remote named `origin` as authoritative and verify that its fetch and push URL is `git@github.com:GDemay/Kheyflix.git` (or the HTTPS equivalent) before pushing, opening a pull request, merging, deploying, or dispatching repository work.
- Never push Kheyflix code, branches, tags, releases, or pull requests to a fork or to any repository owned by another account, including `guillaume-tesla/Kheyflix`.
- All pull requests must target `GDemay/Kheyflix`, normally its `main` branch unless the user explicitly names another base branch.
- If authentication cannot write to `GDemay/Kheyflix`, stop and report the authentication problem. Do not use a fork as a fallback.
- Before handing off work, confirm that the commit is present on `GDemay/Kheyflix` and report the canonical PR or commit URL.
