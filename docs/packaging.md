# Packaging and releases

## Build installers

```sh
pnpm package          # builds everything, then installers for the current OS
pnpm package:dir      # unpacked app only, faster, for checking the bundle
pnpm package:mac-win  # on a Mac: the macOS dmg and the Windows installer together
```

Output goes to `bin/` at the repo root:

| OS      | Output                                   | Notes                                                                    |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| macOS   | `Tessel-<version>-universal.dmg`         | One app for Apple silicon and Intel.                                     |
| Windows | `Tessel Setup <version>.exe` (NSIS, x64) | Per-user install; can choose the folder. ARM PCs run it under emulation. |
| Linux   | `.AppImage` and `.deb` (x64)             | The `.deb` depends on `libxtst6` for key simulation.                     |

Each OS builds its own installers (native modules come from that OS); CI does all three. `pnpm package` runs `pnpm stage:plugins`, which copies the first-party plugins into `build/plugins/` with real, flat `node_modules` (via `pnpm deploy`), so the packaged app can load Voicemeeter's koffi binary for that platform.

What goes in the app:

- `out/` (main, preload, renderer, and `plugin-runner.js`) inside `app.asar`; native `.node` files are unpacked automatically.
- `resources/phone/`: the phone client.
- `resources/plugins/`: first-party plugins.
- Tray and window icons.

The macOS build declares `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`_tessel._tcp`) so macOS asks for Local Network access with a clear reason, and Apple Events for the dark-mode and volume blocks.

## Signing (stubbed for now)

Builds are unsigned unless these are set. electron-builder reads them from the environment, and the release workflow passes them from repository secrets.

**macOS**

- A **Developer ID Application** certificate exported as `.p12`: `CSC_LINK` (base64 or file path) and `CSC_KEY_PASSWORD`.
- Notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) and `APPLE_TEAM_ID`. The release workflow turns notarization on when `APPLE_ID` is present.
- The app runs with the hardened runtime; entitlements are in `packages/desktop/build/entitlements.mac.plist` (JIT for Electron, library validation off so plugins can load native modules, Apple Events, network).
- Unsigned builds: macOS says the app "can't be opened". Right-click the app, choose Open, then Open again.

> Locally, electron-builder signs with any identity it finds in your keychain, such as an "Apple Development" certificate. That's fine for testing but not for giving the app to others. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to build unsigned.

**Windows**

- A code-signing certificate (`.pfx`): `CSC_LINK` and `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` when building on another OS). An EV certificate avoids SmartScreen warnings straight away; a standard one builds reputation over time. Cloud signing (Azure Trusted Signing) needs electron-builder's `win.azureSignOptions` instead.
- Unsigned builds: SmartScreen shows "Windows protected your PC". Choose More info, then Run anyway.

**Linux**

AppImage and deb builds aren't signed. Publish checksums with the release if you want users to verify downloads.

## CI

- `.github/workflows/ci.yml`: typecheck, lint and tests on Ubuntu, Windows and macOS for every push to `main` and every pull request, plus the Electron smoke test on Linux under `xvfb`.
- `.github/workflows/release.yml`: on a `v*` tag (or by hand), packages on all three OSes, uploads the installers as artifacts, and attaches them to a draft GitHub release.

## Version

Bump `version` in `packages/desktop/package.json`, commit, then tag `v<version>` and push the tag.
