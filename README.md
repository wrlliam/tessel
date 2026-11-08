# Tessel

**Tap. Build. Done.** Turn your phone into a control surface for your computer over local Wi-Fi.

The desktop app is the brain. The phone is a remote that only ever says "tile X pressed".

> Status: **Phase 2 (engine and first blocks).** Tiles run real block graphs. There's no editor yet (phase 3), so the starter tiles are fixed; edit `profiles/default.json` by hand if you want to try your own.

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

## Blocks

Every tile is a small graph: a trigger, then blocks joined by wires. Flow wires set the order; value wires carry data (`Get time` › `hour` into `If`).

| Category | Blocks so far                                                 |
| -------- | ------------------------------------------------------------- |
| Trigger  | On press                                                      |
| Action   | Open app, Type text, Key combo, Set setting (dark mode)       |
| Logic    | If (and / or / not conditions, `yes` and `no` outputs), Delay |
| Data     | Get time, Get variable, Set variable                          |

**Templates.** Any text param can use `{{ }}`: `{{var.email}}` (global variable, saved with the profile), `{{local.n}}` (this run only), `{{input.a}}` (a wired value), `{{trigger.type}}`. Expressions support arithmetic, comparisons, `&&` `||` `??`, `a ? b : c` and helpers `upper lower trim len round floor ceil abs min max num str pad`. They are evaluated by a whitelisting interpreter: no `eval`, no prototype access.

**Key combos** are written like `Cmd+Shift+4` or `mod+s` (`mod` is Cmd on macOS, Ctrl elsewhere).

**Safety.** Loops are rejected when a graph is checked, runs stop after 1000 blocks or 30 s, and each tile has a concurrency policy: `queue` (default, up to 5 waiting), `ignore` or `restart`. Pause tiles in the tray stops running tiles.

## Layout

```
packages/
  core/      zod data model, phone protocol, block engine, built-in blocks (no Node or Electron imports)
  server/    Fastify HTTP + WebSocket, pairing, device registry, atomic JSON store, mDNS
  phone/     React PWA served to phones at /
  desktop/   Electron tray app (electron-vite): main process, OS adapters (src/main/platform), React renderer
  brand/     Theme tokens, fonts, logo and icon SVGs
docs/protocol.md   Phone ↔ desktop protocol
```

## Data

Stored as JSON in the OS app-data folder (`~/Library/Application Support/Tessel` on macOS, `%APPDATA%\Tessel` on Windows, `~/.config/Tessel` on Linux). Each file is `{ schemaVersion, data }`, written to a temp file, fsynced and renamed. Older versions are migrated on load; unreadable files are renamed to `*.corrupt-<time>` instead of being overwritten; files from a newer Tessel are refused.

- `settings.json`: Allow phones, port
- `devices.json`: paired devices (SHA-256 of each token, never the token)
- `profiles/default.json`: pages, tiles, graphs and global variables. Created from the starter profile on first run; delete it to reset.

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

**A tile says Tessel needs Accessibility permission (macOS)**: Type text and Key combo simulate keys. Open System Settings › Privacy & Security › Accessibility and turn on Tessel (_Electron_ in development), then press the tile again.

**Dark mode tile says it needs permission (macOS)**: allow Tessel to control _System Events_ under System Settings › Privacy & Security › Automation.

**"Couldn't find an app called …"**: use the name as it appears in Applications (macOS), the Start menu (Windows) or your app launcher (Linux), or give the full path.

**Typing does nothing on Linux**: Wayland blocks simulated keys. Use an X11 session for now; a ydotool fallback is planned.

**Dark mode on Linux** uses GNOME's `color-scheme` setting. Other desktops aren't supported yet. On Windows some apps only notice the change after they restart.

**"Port 4747 is already used by another app"**: another Tessel or app holds the port. Quit it and toggle Allow phones.

**Screen turns off on the phone**: the Wake Lock API needs HTTPS, which plain LAN HTTP isn't. Optional local HTTPS is planned as a later step; until then use the phone's auto-lock setting.

## Known limits

- Over plain `http://` on the LAN, iOS gives no Wake Lock and no service worker (offline cache). Add to Home Screen and full-screen mode still work.
- No haptics on iOS Safari (no Vibration API). The native iOS shell in phase 7 adds them.
- The server runs in Electron's main process. It's small; it moves to a utility process if it ever gets heavy.
- In landscape, a tall grid swaps rows and columns.
- Typing non-ASCII text (accents, emoji) goes through the clipboard: Tessel pastes it, then restores what was there before.
