# Secret boundaries and log-redaction requirements

## Where secrets live (and never live)

| Secret | Held by | Never reaches |
| --- | --- | --- |
| GitHub App private keys, deploy keys, installation tokens | Manager's external tooling only | This repository, the dispatcher process, Harness, logs |
| `KHEYFLIX_GITHUB_TOKEN` (controller PAT/fine-grained token) | Dispatcher process environment only (launchd env file outside the repo) | Harness child processes, argv, git URLs, logs |
| `OPENROUTER_API_KEY` | DeepSeek Harness itself (`$DSH_HOME/.credentials.yaml`) | The control plane, Harness task prompts, logs |
| `/dsh/settings.yaml`, profile dirs | DeepSeek Harness home | Commits (only the *shape* is documented; values stay local) |

Hard rules enforced by code:

1. **Controller-only token.** `KHEYFLIX_GITHUB_TOKEN` is read by
   `control-plane/src/github.js` and by the push credential helper through the
   process environment. It is never placed in a URL, argv, or any Harness
   input. Harness pushes nothing; the controller pushes everything.
2. **Harness child env allowlist** (`harnessChildEnv`): only `PATH`, `HOME`,
   `DSH_HOME`, locale/temp/term variables and the controller git identity are
   passed, plus `KHEYFLIX_TEST_*` in test runs. Anything whose name matches
   `token|secret|password|credential|api_key` is stripped even if injected.
3. **Fail-closed model identity.** Preflight requires exactly
   `openrouter-ox/stealth/ox-alpha`; mismatch or absence aborts the run. No
   fallback provider/model exists anywhere in the codebase.

## Log redaction requirements

Every controller log line and every Harness transcript byte passes
`control-plane/src/redact.js` before reaching console or disk
(`.kheyflix/logs/`, gitignored). Required scrub targets:

- GitHub tokens: `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`, `github_pat_…`
- OpenRouter keys: `sk-or-…`
- Authorization headers carrying bearer-style credentials
- URL-embedded credentials (user and password components inside a URL) and
  x-access-token style userinfo
- Generic credential-style assignments — any of the sensitive key names
  below followed by an assignment or mapping separator and a value:
  api key, access / refresh / installation / app token, secret, password,
  credential, authorization, private key
- Exact runtime secrets registered with the logger (e.g. the live token) are
  split out of strings first, so partial embeddings (push URLs) are covered

Already-redacted spans are never re-mangled, keeping logs readable while
guaranteeing no credential material survives. `npm run guard:secrets`
(`control-plane/scripts/guard-secrets.mjs`) enforces these same patterns
against tracked repository content in CI; it fails closed on any match.

## Repository hygiene

- `.kheyflix/` (SQLite state, locks, worktrees, transcripts) is gitignored;
  state never enters commits.
- No secrets exist in repository content or Actions logs — verified by the
  guard job on every CI run.
- The manager configures authentication externally (GitHub App/token
  injection into the launchd environment); this repo contains only
  documentation of that boundary, never the credentials themselves.
