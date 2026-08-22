# Kheyflix

Agent-only monorepo. An autonomous delivery control plane runs
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) headlessly
(provider/model locked to `openrouter-ox/stealth/ox-alpha`) to implement
manager-labeled GitHub issues, one at a time, end to end:

```
claim → Ox run → controller push/PR → hosted CI → manager review check
      → Ox repair (if needed) → merge → post-merge main CI → next issue
```

Humans never edit the repository; they label issues, review PRs, and transport
commits. The manager configures external authentication and scheduling (see
`docs/launchd.md`); no persistent GitHub self-hosted runner is used.

## Layout

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Binding rules for every agent run |
| `control-plane/` | Local dispatcher: state model, SQLite persistence, locking, Harness driver, GitHub recovery, lifecycle |
| `control-plane/test/` | Hermetic controller tests (no network, no real Harness) |
| `docs/architecture.md` | Control-plane architecture and lifecycle |
| `docs/secrets.md` | Secret boundaries and log-redaction requirements |
| `docs/launchd.md` | External macOS launchd install (every 5 minutes) |
| `.github/workflows/ci.yml` | Minimum hosted CI to bootstrap the repo |

## Quick start

```sh
npm test                # hermetic controller tests
npm run preflight       # fail-closed provider/model check (openrouter-ox/stealth/ox-alpha)
npm run dry-run         # show the one issue that would be selected (fixture or live)
node control-plane/bin/kheyflix.js once     # advance the lifecycle one step/issue
node control-plane/bin/kheyflix.js run      # loop until no eligible work remains
```

The dispatcher requires a GitHub token in `KHEYFLIX_GITHUB_TOKEN` (controller
process only — it is never passed to Harness) and a DeepSeek Harness install
with the `kheyflix-ox` profile. See `docs/architecture.md` for the full design
and `docs/secrets.md` for the trust boundaries.
