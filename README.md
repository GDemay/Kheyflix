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

## Native iOS app

The SwiftUI app in `ios/` is a native shell around the same responsive web
interface and server routes used by the main application. Product UI changes
therefore reach web and iOS together; the iOS target only owns native lifecycle,
safe-area, navigation, offline recovery, and configuration behavior.

For local development, start the IPv4 server used by Simulator and then open
`ios/Kheyflix.xcodeproj` in Xcode:

```sh
npm run dev:ios
open ios/Kheyflix.xcodeproj
```

Run the `Kheyflix` scheme on a current iPhone simulator. Its test plan includes
Swift unit tests, a deterministic offline UI test, live Rabbit playback, and an
AllDebrid failure-to-Rabbit recovery test. Live tests skip when the development
server is not running.

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
