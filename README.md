# Kheyflix

Kheyflix is a Vinext/React streaming interface with server-side AllDebrid access
and an FFmpeg compatibility service.

## Local development

Requirements: Node.js 22+, npm, FFmpeg, and FFprobe.

```sh
cp /Users/gdemay/Documents/Projects/Kheyflix/.env.local .env.local
chmod 600 .env.local
npm ci
npm run dev
```

The ignored `.env.local` enables the catalog, playback, and discovery.
`TMDB_READ_ACCESS_TOKEN` is optional and enriches movie metadata.

## Quality checks

```sh
npm test
npm run lint
npm run build
```

## Railway deployment

The committed Railway and Nixpacks configuration installs FFmpeg, builds the
application, starts the web and transcoder processes together, checks
`/api/health`, and restarts failed deployments.

Kheyflix has isolated `staging` and `production` Railway environments. Railway
control-plane work is performed only through the configured Railway MCP; the
tracked `npm run deploy:*` commands deliberately fail closed so a local checkout
cannot upload or alter a service. Use public deployment checks only after an
approved rollout:

```sh
npm run verify:staging
```

Production automatically deploys canonical GitHub `main`. Run
`npm run verify:production` and the real-catalog playback suite after every
production rollout.

See [docs/deployment.md](docs/deployment.md) for environment URLs, secret
management, promotion, rollback, and troubleshooting.

See [docs/observability.md](docs/observability.md) for structured production
logs, request correlation, browser diagnostics, and the incident workflow.

Never commit `.env*` or real credential values. Rotate any credential that has
been exposed outside its intended secret store.
