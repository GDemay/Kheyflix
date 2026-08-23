# Kheyflix for iOS

The iOS app is a SwiftUI/WKWebView native shell around the canonical React product. UI and routing therefore remain shared with the web app; server-side fixes deploy once and reach iOS without a parallel rewrite. Swift owns the app lifecycle, safe areas, native media policy, loading/offline recovery, and external-navigation security.

## Local development

1. Copy the repository `.env.local` as documented at the root and run `npm run dev:ios`.
2. Open `ios/Kheyflix.xcodeproj` in Xcode.
3. Select the `Kheyflix` scheme and a current iPhone simulator, then Run.

Debug and Release builds use the public production service by default. To test a
local checkout, pass `--server-url http://127.0.0.1:3001` in the scheme launch
arguments after starting `npm run dev:ios`, or use the native Server Settings
recovery sheet. A physical iPhone must use the Mac's LAN address rather than its
loopback address.

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
