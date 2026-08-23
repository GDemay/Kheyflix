# Kheyflix for iOS

The iOS app is a SwiftUI/WKWebView native shell around the canonical React product. UI and routing therefore remain shared with the web app; server-side fixes deploy once and reach iOS without a parallel rewrite. Swift owns the app lifecycle, safe areas, native media policy, loading/offline recovery, and external-navigation security.

## Local development

1. Copy the repository `.env.local` as documented at the root and run `npm run dev:ios`.
2. Open `ios/Kheyflix.xcodeproj` in Xcode.
3. Select the `Kheyflix` scheme and a current iPhone simulator, then Run.

Debug builds use `http://127.0.0.1:3001`; use `npm run dev:ios` to start the shared app and transcoder with the IPv4 listener required by Simulator. A physical iPhone cannot resolve the Mac loopback; use the native Server Settings recovery sheet or change `KHEYFLIX_BASE_URL` in the target configuration to an HTTPS deployment or the Mac's LAN address.

## Tests

Run the `Kheyflix` scheme's Test action or:

```sh
xcodebuild test -project ios/Kheyflix.xcodeproj -scheme Kheyflix -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

The baseline UI test uses a bundled deterministic fixture and does not require a
network connection. Live tests exercise Rabbit playback and AllDebrid failure
recovery against the shared development server; no API credential belongs in
this project or app bundle.

When `npm run dev:ios` is running, the suite detects it automatically and runs
the live regressions; otherwise those network-dependent tests are skipped.
