# Deployment runbook

## Environments

| Environment | URL | Deployment source | Purpose |
| --- | --- | --- | --- |
| Staging | <https://kheyflix-staging.up.railway.app> | Manual CLI upload of the current checkout | Pre-merge and release verification |
| Production | <https://kheyflix-production.up.railway.app> | Automatic deploy from `GDemay/Kheyflix` `main` | Public service |

Both Railway environments have isolated service variables and deployments.
They currently use the same authorized AllDebrid/Prowlarr accounts, but values
are stored separately so either environment can be rotated independently.

Each environment also runs an isolated Prowlarr service on port 9696 with a
persistent `/config` volume. Staging uses `prowlarr` and production uses
`prowlarr-production`; Kheyflix reaches them through Railway's private network
at `http://<service>.railway.internal:9696`. Prowlarr does not need a public
domain. Deploy its checked-in image explicitly when its container definition
changes:

```sh
railway up prowlarr --path-as-root --service prowlarr --environment staging --detach
railway up prowlarr --path-as-root --service prowlarr-production --environment production --detach
```

Both services require a persistent volume mounted at `/config` plus
`PROWLARR_API_KEY`, `PORT=9696`, `PUID=0`, `PGID=0`, and the desired `TZ`.

## Resource profile

Every service instance is capped at Railway's minimum 0.5 vCPU and 500 MB of
memory. The public Kheyflix service uses Railway Serverless in both environments
and scales to zero when idle. Keep the private Prowlarr services always on:
Railway does not wake a sleeping private-only service from internal traffic, so
enabling Serverless there makes discovery fail after the idle timeout. This is
the lowest stable profile that preserves catalog discovery after cold starts.

## Local secrets

The authoritative local secret store is outside all worktrees:

```text
/Users/gdemay/Documents/Projects/Kheyflix/.env.local
```

It must remain mode `0600`. Copy it into a new worktree as ignored runtime
configuration before local integration work:

```sh
cp /Users/gdemay/Documents/Projects/Kheyflix/.env.local .env.local
chmod 600 .env.local
```

Required server-side values are `ALLDEBRID_API_KEY`, `PROWLARR_URL`, and
`PROWLARR_API_KEY`. `RAILWAY_TOKEN` enables non-interactive CLI deployments.
`TMDB_READ_ACCESS_TOKEN` is optional. Never expose any of these to browser code,
commit them, put them in command output, or add them to a GitHub secret unless a
GitHub Actions workflow specifically needs that credential.

Railway's native GitHub integration deploys production, so it does not require
a duplicated `RAILWAY_TOKEN` GitHub secret.

## Release flow

1. Run `npm ci`, `npm test`, `npm run lint`, and `npm run build`.
2. Deploy the candidate checkout with `npm run deploy:staging`.
3. If `prowlarr/` changed, deploy the staging Prowlarr service with the command
   above.
4. Wait for Railway to report `SUCCESS` and run `npm run verify:staging`.
5. Exercise catalog, discovery, detail, and playback flows in the staging UI.
6. Merge the reviewed pull request into canonical `main`.
7. If `prowlarr/` changed, deploy the production Prowlarr service.
8. Wait for the automatic production deployment and run
   `npm run verify:production`.

The deployment commands use the linked Railway CLI owner session. For CI, set
an environment-scoped `RAILWAY_TOKEN` in the runner process; the scripts do not
load `.env.local`, preventing a production-scoped token from accidentally being
used for staging.

## Secret synchronization

Set secrets through stdin so values do not appear in shell history or output:

```sh
printf '%s' "$ALLDEBRID_API_KEY" | railway variable set ALLDEBRID_API_KEY --stdin --service kheyflix --environment staging
```

Repeat explicitly for each variable and environment. Verify only variable
names; Railway JSON variable output includes raw secret values.

## Observability and rollback

```sh
railway deployment list --service kheyflix --environment staging --json
railway logs --service kheyflix --environment staging --latest
railway logs --http --service kheyflix --environment staging --status '>=400' --lines 100
railway rollback --service kheyflix --environment staging
```

Use `production` instead of `staging` for production incidents. The Railway
health check calls `/api/health`; the verification scripts additionally require
a reachable home page, a non-empty playable AllDebrid catalog, and a working
Prowlarr discovery response.
