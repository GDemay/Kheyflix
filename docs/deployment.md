# Deployment runbook

## Authorized boundaries

Kheyflix production is the application service
`1fb8e716-8ba7-4906-80fd-9226e0eeb43e` in production environment
`ed9b7bff-19ed-4ff8-9b9f-ff159411c11a`, within project
`aa2423af-32c8-4dc0-9129-3db69c7e4a5d`. The companion Prowlarr service is
`5c2d7142-a357-4f99-a8fb-bcf6f47fbee5`.

All Railway control-plane work—service configuration, variables, deployment
state, logs, metrics, and recovery—uses the configured Railway MCP. Do not use
a local CLI, token, dashboard, browser, HTTP API, SDK, or alternate account.
The tracked `npm run deploy:staging` and `npm run deploy:production` commands
are intentional fail-closed guardrails, not deployment mechanisms.

Before a Railway write, verify the authenticated account and the exact project,
environment, and service IDs through the MCP. Request explicit approval for a
destructive operation, including a service or domain removal, storage removal,
redeploy, staged-deploy acceptance, or an infrastructure-changing agent action.

## Environments

| Environment | URL | Deployment source | Purpose |
| --- | --- | --- | --- |
| Staging | <https://kheyflix-staging.up.railway.app> | Approved Railway MCP workflow | Manual review only; no automated OIDC verifier is authorized yet |
| Production | <https://kheyflix-production.up.railway.app> | Automatic deployment from `GDemay/Kheyflix` `main` | Public service |

Production source remains `GDemay/Kheyflix` on `main`. Never use a fork or a
local upload as a production source. If the MCP cannot perform a required
staging or recovery operation, stop and report that capability gap rather than
substituting another client.

`npm run verify:production` is intentionally bound to the canonical `main`
GitHub Actions identity and production audience. It must not be pointed at
staging: doing so would either fail audience validation or weaken the
production trust boundary. Add a staging verifier only with a separately
reviewed deployment source and OIDC claim contract.

## Secrets and private dependencies

The canonical local runtime file is the ignored, mode-`0600`
`/Users/gdemay/Documents/Projects/Kheyflix/.env.local`. Copy it only into a
new worktree's ignored `.env.local` when local integration testing needs it.
Never print, commit, place in browser code, or add secret values to a GitHub
workflow. The required server-side provider values are AllDebrid and Prowlarr
credentials. Protected playback also requires all three distinct server-side
access values in the approved secret store: `KHEYFLIX_ACCESS_TOKEN`,
`KHEYFLIX_SESSION_SECRET`, and `KHEYFLIX_INTERNAL_TRANSCODER_TOKEN`. A partial
set is intentionally reported as degraded and blocks provider-backed playback.

Prowlarr runs privately on port 9696 with its persistent `/config` volume. The
application reaches it through the private service address configured in its
environment. It has no public domain.

## Release verification

1. On a branch, run `npm ci`, `npm test`, `npm run lint`, `npm run build`, and
   relevant local UI/playback checks.
2. Push only to `GDemay/Kheyflix`, open a pull request to `main`, and resolve
   every CI failure on that branch. Do not merge a red or pending pull request.
3. Merge through the green pull request. Wait for the `main` workflow associated
   with that exact merge commit and for the automatic production deployment.
4. Confirm public `/api/health` reports the exact merge commit and healthy
   required dependencies. Run `npm run verify:production` and the real-catalog
   playback suite.
5. For a playback change, verify a first decoded frame followed by continuously
   advancing playback on laptop Safari and iPhone Safari (or iOS Simulator).

The public health and playback URLs are appropriate for user-visible
verification. Use the Railway MCP for all control-plane observations and
actions.
