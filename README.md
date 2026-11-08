# Tessel

**Tap. Build. Done.** Turn your phone into a control surface for your computer over local Wi-Fi.

The desktop app is the brain. The phone is a remote that only ever says "tile X pressed".

> Status: **Phase 1 (skeleton).** Pairing and a hard-coded grid. Tiles don't run actions yet; presses show up in the desktop's Activity log.

## Requirements

- Node 22.18 or newer
- pnpm 12 (`corepack enable` will pick up the version pinned in `package.json`)
- A phone on the same Wi-Fi as the computer

## Setup

```sh
pnpm install
pnpm dev        # builds the phone client, then starts the desktop app with hot reload
```

The first `pnpm dev` downloads the Electron binary.

## Connect your iPhone

1. Start Tessel. The window shows a QR code and a 6-digit code. **Allow phones** must be on.
2. Scan the QR code with the iPhone Camera and open the link in Safari.
3. Type the 6-digit code. The grid appears.
4. Tap **Share › Add to Home Screen**, then open Tessel from the Home Screen and **pair once more**. iOS gives Home Screen web apps their own storage, separate from Safari, so the token from step 3 isn't visible there.

Paired phones are listed in the window. **Remove** disconnects one immediately and invalidates its token.

## Scripts

| Command                           | What it does                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                        | Build phone client, run desktop app with HMR                                              |
| `pnpm --filter @tessel/phone dev` | Phone client on Vite with HMR, proxying `/api` and `/ws` to a running desktop app on 4747 |
| `pnpm build`                      | Build every package                                                                       |
| `pnpm check`                      | Typecheck, lint and test                                                                  |
| `pnpm icons`                      | Re-render PNG icons from the SVGs in `packages/brand`                                     |

## Layout

```
packages/
  core/      zod data model, phone protocol, sample profile (no Node or Electron imports)
  server/    Fastify HTTP + WebSocket, pairing, device registry, atomic JSON store, mDNS
  phone/     React PWA served to phones at /
  desktop/   Electron tray app (electron-vite): main process, preload, React renderer
  brand/     Theme tokens, fonts, logo and icon SVGs
docs/protocol.md   Phone ↔ desktop protocol
```

## Data

Stored as JSON in the OS app-data folder (`~/Library/Application Support/Tessel` on macOS, `%APPDATA%\Tessel` on Windows, `~/.config/Tessel` on Linux). Each file is `{ schemaVersion, data }`, written to a temp file, fsynced and renamed. Older versions are migrated on load; unreadable files are renamed to `*.corrupt-<time>` instead of being overwritten; files from a newer Tessel are refused.

- `settings.json`: Allow phones, port
- `devices.json`: paired devices (SHA-256 of each token, never the token)

## Security

- The server listens on `0.0.0.0` only while **Allow phones** is on.
- Pairing codes expire after 5 minutes and work once. Wrong guesses are rate-limited per IP and the code is replaced after 20 failures in total.
- Requests need a LAN-style `Host` (IP, `localhost` or `*.local`) and, for pairing and WebSocket, a matching `Origin`.
- Phones can only send press events for tile ids that exist. They never receive tile graphs.

## Troubleshooting

**Phone shows "Can't reach your computer" or the page never loads**

- Both devices must be on the same Wi-Fi. Guest networks and some office networks isolate devices.
- macOS: System Settings › Privacy & Security › **Local Network**, turn on Tessel (it shows as _Electron_ in development). Also check System Settings › Network › Firewall › Options.
- Windows: allow Tessel on **Private** networks when the firewall asks, and make sure the Wi-Fi profile is Private.
- Linux: open the port if a firewall is on, e.g. `sudo ufw allow 4747/tcp`.
- Several addresses listed? VPNs (like Tailscale) add extra ones. Pick the one on your Wi-Fi under the QR code.

**"Port 4747 is already used by another app"**: another Tessel or app holds the port. Quit it and toggle Allow phones.

**Screen turns off on the phone**: the Wake Lock API needs HTTPS, which plain LAN HTTP isn't. Optional local HTTPS is planned as a later step; until then use the phone's auto-lock setting.

## Known limits (phase 1)

- Over plain `http://` on the LAN, iOS gives no Wake Lock and no service worker (offline cache). Add to Home Screen and full-screen mode still work.
- No haptics on iOS Safari (no Vibration API). The native iOS shell in phase 7 adds them.
- The server runs in Electron's main process. It's small; it moves to a utility process if it ever gets heavy.
- In landscape, a tall grid swaps rows and columns.
