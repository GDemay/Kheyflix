# Kheyflix

Kheyflix is a Vinext/React streaming interface with server-side AllDebrid access
and an FFmpeg compatibility service.

## Local development

Requirements: Node.js 22+, npm, FFmpeg, and FFprobe.

```sh
cp .env.example .env
npm ci
npm run dev
```

Set `ALLDEBRID_API_KEY` in `.env` to enable library and playback features.
`TMDB_READ_ACCESS_TOKEN` is optional and enriches catalog metadata.

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

1. Put a Railway project token in the ignored local `.env` as `RAILWAY_TOKEN`.
2. Link the checkout with `railway link` if it is not already linked.
3. Add `ALLDEBRID_API_KEY` and optionally `TMDB_READ_ACCESS_TOKEN` with
   `railway variable set`.
4. Deploy with `railway up --detach` and create a public domain with
   `railway domain`.

Never commit `.env` or real credential values. Rotate any credential that has
been exposed outside its intended secret store.
