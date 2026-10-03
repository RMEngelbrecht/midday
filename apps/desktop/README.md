# Midday Desktop App

A Tauri shell around a self-hosted Midday dashboard, with a native transparent
titlebar on macOS, a global search shortcut and deep-link login.

## Choosing a server

The app is not tied to any hosted instance. On first launch it shows a screen
asking for your dashboard URL (your `APP_URL`, e.g. `https://midday.example.com`).

1. The app fetches `<url>/api/instance` (served by the dashboard, unauthenticated)
   which returns `{ appUrl, apiUrl, desktopScheme, version }`.
2. The reported `appUrl`/`apiUrl` are saved to `server.json` in the app config
   directory (macOS: `~/Library/Application Support/<bundle id>/`).
3. IPC access (`window.__TAURI__`) is granted only to those two origins through a
   runtime capability derived from `src-tauri/capabilities/default.json`;
   navigation to any other http(s) origin opens in the system browser.

Use **Change Server...** (application menu or tray menu) to pick another server.

## Deep-link login

Login in the system browser returns to the app through `<scheme>://api/auth/callback?code=...`.
The scheme is fixed at build time in `src-tauri/tauri.conf.json`
(`plugins.deep-link.desktop.schemes`, default `midday`; the dev config uses
`midday-dev`). **`DESKTOP_SCHEME` on the server must equal this scheme.** The
server reports its value in `/api/instance`; if you build with a custom scheme,
set the same `DESKTOP_SCHEME` on the server.

## Running and building

```bash
bun run tauri:dev        # dev server for the setup screen + dev scheme (midday-dev)
bun run tauri:build      # release build, no auto-update
cd src-tauri && cargo test   # server URL/config logic
```

## Updates

The updater is off by default. To ship updates from your fork's GitHub Releases:

```bash
MIDDAY_UPDATER_REPO=owner/repo \
MIDDAY_UPDATER_PUBKEY="<contents of your tauri signer .pub>" \
TAURI_SIGNING_PRIVATE_KEY=... \
bun run tauri:build:release
```

This builds with `plugins.updater` pointing at
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`
(upload the generated `latest.json` and signatures with each release). Builds
without it have no updater and no "Check for Updates..." menu item.
