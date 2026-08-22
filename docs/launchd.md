# External install: macOS launchd dispatcher (every 5 minutes)

The manager installs scheduling **outside** this repository. Nothing here
configures a persistent GitHub self-hosted runner — the dispatcher is a plain
local process that starts, advances the lifecycle, parks, and exits.

## 1. Prerequisites (manager-side, one time)

- Node.js >= 22.5 on the host.
- This repository cloned locally (e.g. `/Users/manager/Kheyflix`).
- A DeepSeek Harness install with the `kheyflix-ox` profile and
  `OPENROUTER_API_KEY` configured in `$DSH_HOME` (`.credentials.yaml`).
- A GitHub fine-grained token with `contents: write`, `pull-requests: write`
  on this repository only. Keep it in a root-only env file, e.g.
  `/usr/local/etc/kheyflix.env`:

```sh
# /usr/local/etc/kheyflix.env — chmod 600, owner: manager
# KHEYFLIX_GITHUB_TOKEN is injected into this file by the manager's secret
# mechanism; its value is never committed anywhere.
KHEYFLIX_REPO=GDemay/Kheyflix
KHEYFLIX_REPO_PATH=/Users/manager/Kheyflix
```

## 2. LaunchAgent plist

`~/Library/LaunchAgents/com.kheyflix.dispatcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kheyflix.dispatcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/manager/Kheyflix/control-plane/bin/kheyflix.js</string>
    <string>run</string>
    <string>--max-steps</string>
    <string>8</string>
    <string>--poll-ms</string>
    <string>20000</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DSH_HOME</key><string>/Users/manager/.dsh</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/usr/local/var/log/kheyflix/dispatcher.out.log</string>
  <key>StandardErrorPath</key><string>/usr/local/var/log/kheyflix/dispatcher.err.log</string>
  <key>WorkingDirectory</key><string>/Users/manager/Kheyflix</string>
</dict>
</plist>
```

Notes:

- `StartInterval 300` = every five minutes. Overlapping runs are impossible:
  the directory lock in `.kheyflix/dispatcher.lock` rejects a second
  dispatcher, and stale locks are broken automatically after
  `KHEYFLIX_LOCK_STALE_MS`.
- The token env file is injected by the manager's own mechanism (e.g.
  `launchctl setenv` from a protected script, or a `Envfile`-reading wrapper).
  It must never be committed.

## 3. Load and verify

```sh
mkdir -p /usr/local/var/log/kheyflix
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kheyflix.dispatcher.plist
launchctl kickstart -k gui/$(id -u)/com.kheyflix.dispatcher   # force one tick
tail -f /usr/local/var/log/kheyflix/dispatcher.err.log        # redacted JSONL
node control-plane/bin/kheyflix.js status                     # runs + events
```

Uninstall:

```sh
launchctl bootout gui/$(id -u)/com.kheyflix.dispatcher
rm ~/Library/LaunchAgents/com.kheyflix.dispatcher.plist
```

## 4. Why not a self-hosted runner

Deliberately not used: a persistent runner would hold long-lived credentials
inside GitHub's trust boundary. The launchd model keeps all credentials on the
manager's host, runs only when scheduled, and the controller performs every
GitHub interaction itself — Harness never touches GitHub.
