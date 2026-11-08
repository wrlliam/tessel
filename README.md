# Tessel

[![CI](https://github.com/wrlliam/tessel/actions/workflows/ci.yml/badge.svg)](https://github.com/wrlliam/tessel/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/wrlliam/tessel)](https://github.com/wrlliam/tessel/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Tap. Build. Done.** Turn your phone into a control surface for your computer over local Wi-Fi.

The desktop app is the brain. The phone is a remote that only ever says "tile X pressed".

> Status: all seven phases of the first version are built: pairing, the block engine and editor, pages and profiles, system settings, plugins, packaging and an iPhone app. See [Known limits](#known-limits) for what hasn't been tried on real hardware yet.

## Download

Get the installer for your computer from the [latest release](https://github.com/wrlliam/tessel/releases/latest):

| OS                              | File                             |
| ------------------------------- | -------------------------------- |
| macOS (Apple silicon and Intel) | `Tessel-<version>-universal.dmg` |
| Windows (x64)                   | `Tessel-Setup-<version>.exe`     |
| Linux                           | `.AppImage` or `.deb`            |

Builds aren't signed yet. On macOS, right-click Tessel, choose Open, then Open again. On Windows, choose More info, then Run anyway. Then open Tessel, go to **Phones**, and scan the QR code with your phone.

## Requirements

- Node 22.18 or newer
- pnpm 12 (`corepack enable` will pick up the version pinned in `package.json`)
- A phone on the same Wi-Fi as the computer
- For the iPhone app only: a Mac with Xcode and a (free) Apple ID

## Setup

```sh
pnpm install
pnpm dev        # builds plugins and the phone client, then starts the desktop app with hot reload
```

The first `pnpm dev` downloads the Electron binary.

## Build installers

```sh
pnpm package          # installers for this OS in bin/
pnpm package:mac-win  # on a Mac: the macOS and Windows installers
pnpm release          # upload bin/ installers to a draft GitHub release (needs gh)
```

macOS gives a universal `.dmg`, Windows an NSIS `.exe`, Linux an `.AppImage` and `.deb`. CI builds all three on a version tag. Signing is stubbed: see [docs/packaging.md](docs/packaging.md) for what each OS needs and how to open unsigned builds.

## On the phone

Swipe sideways or tap the dots to change page. Folder tiles open their page; Back returns. A tap fires when you lift your finger (or after a short hold), so starting a swipe on a tile never presses it. The **⋯** menu has **Dim screen** (a dark overlay for OLED phones; tiles still work), **Choose another computer** (iPhone app) and **Forget this computer**.

**Phone settings live on the desktop.** The **Phones** tab has an **On the phone** card with a live preview: theme (follow the phone, dark, light), key colour (tinted keys keep the face neutral with a coloured light; solid fills the key), labels and their size, spacing, the page name bar, vibrate on press, keep the screen on and dim strength. Changes reach connected phones at once, and phones keep the last settings for when they reconnect.

**Held sideways.** **Fill** stretches the keys across the whole screen (wide keys put the icon beside the label), **Fit** keeps keys square and centred, **Rotate** swaps rows and columns.

## Connect your iPhone

1. Start Tessel. The window shows a QR code and a 6-digit code. **Allow phones** must be on.
2. Scan the QR code with the iPhone Camera and open the link in Safari.
3. Type the 6-digit code. The grid appears.
4. Tap **Share › Add to Home Screen**, then open Tessel from the Home Screen and **pair once more**. iOS gives Home Screen web apps their own storage, separate from Safari, so the token from step 3 isn't visible there.

Paired phones are listed in the window. **Remove** disconnects one immediately and invalidates its token.

## iPhone app (optional)

`packages/ios-shell` is a small native app (Capacitor) that finds Tessel on your Wi-Fi, opens the same phone page, and adds what Safari can't: haptics and keeping the screen awake. You build it yourself in Xcode; a free Apple ID is enough.

1. Run `pnpm ios:open`. It builds the start screen, syncs the iOS project and opens it in Xcode.
2. In Xcode, select the **App** project, then the **App** target, then **Signing & Capabilities**:
   - **Team**: choose your Apple ID (Xcode › Settings › Accounts › + if it isn't listed). Free accounts show as "(Personal Team)".
   - **Bundle Identifier**: change `app.tessel.shell` to something unique, like `com.yourname.tessel`.
3. Connect your iPhone with a cable, unlock it and tap **Trust**. On iOS 16 and later, turn on **Settings › Privacy & Security › Developer Mode** and restart the phone when asked.
4. Pick your iPhone as the run destination at the top of Xcode and press **Run** (⌘R).
5. The first launch is blocked: on the iPhone open **Settings › General › VPN & Device Management**, tap your Apple ID under Developer App and **Trust** it. Open Tessel again.
6. Allow **Local Network** when asked. Tessel lists computers running Tessel; tap yours (or type the address under the QR code), then pair with the 6-digit code.

With a free Apple ID the app stops opening after **7 days**. Plug the phone in and press Run again to renew it; your pairing is kept. Free accounts can have 3 such apps on a device at once. A paid Apple Developer account removes the limit.

In the app, the **⋯** menu has **Choose another computer**.

## Scripts

| Command                           | What it does                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                        | Build phone client, run desktop app with HMR                                              |
| `pnpm --filter @tessel/phone dev` | Phone client on Vite with HMR, proxying `/api` and `/ws` to a running desktop app on 4747 |
| `pnpm build`                      | Build every package                                                                       |
| `pnpm check`                      | Typecheck, lint and test                                                                  |
| `pnpm icons`                      | Re-render PNG icons from the SVGs in `packages/brand`                                     |
| `pnpm package`                    | Build installers for this OS (`pnpm package:dir` for an unpacked app)                     |
| `pnpm ios:open`                   | Build and sync the iPhone app, then open it in Xcode                                      |

## Editor

The window has four tabs: **Editor**, **Phones** (pairing and devices), **Plugins** and **Settings** (port, start on login, theme, shell commands, activity log level).

- **Left:** the profile, its pages and the page as your phone shows it.
  - **Profiles** (e.g. Work, Gaming): create, duplicate, rename, delete, import and export. **Use on phones** picks the one phones see; the tray menu has a Profile submenu too. Each profile has its own variables.
  - **Pages:** add, rename, reorder, set columns and rows. Phones swipe between pages in this order.
  - **Tiles:** click an empty slot to add a blank tile, a folder or a template. Drag tiles to move them and drag the corner of the selected tile to resize; the inspector has the same controls for the keyboard.
  - **Folders** are tiles that open their own page. The phone adds a Back tile in its top-left slot.
- **Centre:** the block canvas, with a categorised palette beside it. Drag blocks in, or press `Space` or right-click on the canvas to search. Drag from a port to another to wire them; ports only accept compatible wires, and loops are refused.
- **Right:** the inspector for the selected block's settings, its wires (connect and disconnect without a mouse), and the tile: label, icon (a named icon or one emoji), colour, position, size, what a press does while it is still running, and **live appearance**.
- **Bottom:** the run log. Click a failed run to jump to the block that failed.

**Live appearance.** A tile's label, colour or icon can follow variables, e.g. label `Count: {{var.count ?? 0}}`, and the **Set tile appearance** block can change them while a tile runs (use it for status, like a mute tile turning red). It can change this tile or any other tile in the profile, and with **Keep it after Tessel restarts** the new look is saved; **Reset** returns a tile to its settings. The phone and the editor's grid show the live look.

**Templates** (about 40, searchable, in groups): Meetings (Zoom, Teams, Google Meet and Discord mute, camera, share, raise hand, leave), Media and sound, Apps (Spotify, Slack, VS Code, browser tabs), System (screenshot, record screen, emoji picker, show desktop, dark mode, lock), Productivity and Examples. Mute tiles in meeting apps flip their own status, so if you also mute in the app itself they can drift until the next press.

**App command** sends a known shortcut to an app, picking the right keys for your OS and optionally bringing the app to the front first: Zoom, Microsoft Teams, Google Meet, Discord, Slack, Spotify, VS Code, the browser, and system shortcuts. Commands an app doesn't have on your OS say so when pressed.

**Import and export.** A profile exports as a `.tessel` file (a zip of JSON, including its variables, so check them before sharing). Importing shows which blocks the profile uses and asks before adding it as a new profile.

**Test run** saves and runs the tile; blocks show their status as they run (time taken, failed, skipped). Presses from your phone light up the canvas too. Edits save automatically.

| Shortcut (Ctrl on Windows/Linux) |                                 |
| -------------------------------- | ------------------------------- |
| `Space` / right-click on canvas  | Add a block                     |
| `⌘Z` / `⇧⌘Z`                     | Undo / redo                     |
| `⌘C` / `⌘V` / `⌘D`               | Copy / paste / duplicate blocks |
| `⌘↵`                             | Test run                        |
| `Delete` / `Backspace`           | Remove selected blocks or wires |

## Blocks

Every tile is a small graph: a trigger, then blocks joined by wires. Flow wires set the order; value wires carry data (`Get time` › `hour` into `If`).

| Category | Blocks                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger  | On press, On long press, On release, On page open, On schedule                                                                                                                                                                        |
| Action   | Open app, App command, Open URL, Open file, Type text, Key combo, Media key, Mouse, Set clipboard, Notification, HTTP request, Run shell command, Switch page, Run another tile, Set tile appearance, Set setting, Lock screen, Sleep |
| Logic    | If, Switch, Compare, Toggle, Delay, Repeat, Wait until                                                                                                                                                                                |
| Data     | Get time, Get variable, Set variable, Math, Text, Random                                                                                                                                                                              |

**Triggers.** On press fires as soon as the phone commits the tap. If a tile also has **On long press**, the two take turns: a short tap fires On press when you lift, holding half a second fires On long press instead. **On release** fires when you lift. **On page open** fires when a phone shows the tile's page. **On schedule** takes a cron pattern (`0 9 * * 1-5` is 9:00 on weekdays; a sixth field adds seconds) and runs for the profile phones are using, in the computer's time zone; the editor shows the next three times.

**Toggle** flips between its `now on` and `now off` outputs on each run and remembers where it was (saved with the profile), so `{{state.on}}` can drive live appearance. **Repeat** runs what is wired to `each time` up to 100 times, then `then`. **Wait until** re-checks its condition, reading wires again each time. **Run another tile** presses another tile and waits for it; tiles that would run each other in a circle are refused.

### System settings by OS

**Set setting** covers dark mode, mute, volume and brightness. Everything is best effort: when an OS can't do something, the block says so plainly.

|                         | macOS                                             | Windows                                                | Linux                                         |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| Dark mode               | AppleScript (asks for Automation permission once) | Registry (`AppsUseLightTheme`, `SystemUsesLightTheme`) | GNOME `gsettings`                             |
| Volume, mute            | AppleScript                                       | Core Audio via PowerShell (about a second per change)  | `pactl`, or `wpctl` on PipeWire               |
| Brightness              | Needs `brew install brightness`                   | Built-in laptop screens only (WMI)                     | Needs `brightnessctl`                         |
| Lock screen             | Ctrl+Cmd+Q (needs Accessibility)                  | `LockWorkStation`                                      | `loginctl lock-session`, or `xdg-screensaver` |
| Sleep                   | `pmset sleepnow`                                  | Suspend                                                | `systemctl suspend`                           |
| Keys, media keys, mouse | nut-js (needs Accessibility)                      | nut-js                                                 | nut-js on X11 only                            |

**Shell commands** are off until you change **Settings › Safety**. "Ask every time" shows each command and waits for you. HTTP responses over 1 MB are cut short.

**Templates.** Any text param can use `{{ }}`: `{{var.email}}` (global variable, saved with the profile), `{{local.n}}` (this run only), `{{input.a}}` (a wired value), `{{trigger.type}}`. Expressions support arithmetic, comparisons, `&&` `||` `??`, `a ? b : c` and helpers `upper lower trim len round floor ceil abs min max num str pad`. They are evaluated by a whitelisting interpreter: no `eval`, no prototype access.

**Key combos** are written like `Cmd+Shift+4` or `mod+s` (`mod` is Cmd on macOS, Ctrl elsewhere).

**Safety.** Loops are rejected when a graph is checked, runs stop after 1000 blocks or 30 s, and each tile has a concurrency policy: `queue` (default, up to 5 waiting), `ignore` or `restart`. Pause tiles in the tray stops running tiles.

## Plugins

Plugins add blocks and triggers and run in their own processes; a crashing plugin is restarted with backoff and never takes Tessel down. The **Plugins** tab lists them with their status and permissions, turns them on and off, shows a settings form for each, and installs new ones from a folder or a zip. **Load for development** uses a folder in place and reloads it when files change. Before an installed plugin starts, Tessel shows the permissions it declares and asks; plugins still run with your account's rights, so install only ones you trust. Phones can't install or enable plugins.

Write your own with `pnpm create-plugin my-plugin` (see [docs/plugins.md](docs/plugins.md)).

### Voicemeeter (Windows)

Works with Voicemeeter Basic, Banana and Potato through VB-Audio's Remote API. Tessel finds `VoicemeeterRemote64.dll` from Voicemeeter's installer entry in the registry and loads it with koffi; Voicemeeter itself must be running.

Blocks: Set gain, Mute (mute, unmute or toggle; strips or buses), Solo, Routing (A1–A5, B1–B3, as your version has them), Macro button, Load preset, Get level, Get parameter, Set parameter (any name, such as `Strip[0].Label`). Trigger: **On parameter change**, which polls Voicemeeter's change flag 20 times a second and fires once when the profile loads.

A mute tile that turns red while muted: add **On parameter change** for `Strip[0].Mute` with _Keep as tile state named_ `muted`, wire it to nothing, add a press graph with **Mute** (toggle), and give the tile live appearance `Colour: {{state.muted ? "#F25C6E" : "#212833"}}`. On macOS and Linux its blocks say "Voicemeeter is Windows-only."

### System info

A small example plugin: **System info** (CPU, memory and uptime as values) and **On high CPU** (starts a tile when CPU use goes above a level).

## Layout

```
packages/
  core/      zod data model, phone protocol, block engine, built-in blocks (no Node or Electron imports)
  server/    Fastify HTTP + WebSocket, pairing, device registry, atomic JSON store, mDNS
  phone/     React PWA served to phones at /
  desktop/   Electron tray app (electron-vite): main process, OS adapters (src/main/platform), React renderer
  brand/     Theme tokens, fonts, shared tile icons, logo and icon SVGs
  plugin-sdk/              Plugin types, manifest schema, runtime, runner and test harness
  create-tessel-plugin/    Scaffolding CLI
plugins/
  voicemeeter/   Voicemeeter Remote API plugin (koffi; mock API for tests)
  system/        System info example plugin
  ios-shell/     iPhone app (Capacitor): start screen, Bonjour discovery plugin (Swift), Xcode project
docs/
  protocol.md    Phone ↔ desktop protocol
  plugins.md     Writing plugins
  packaging.md   Installers, signing, CI
.github/workflows/  CI (all three OSes) and release builds
```

## Data

Stored as JSON in the OS app-data folder (`~/Library/Application Support/Tessel` on macOS, `%APPDATA%\Tessel` on Windows, `~/.config/Tessel` on Linux). Each file is `{ schemaVersion, data }`, written to a temp file, fsynced and renamed. Older versions are migrated on load; unreadable files are renamed to `*.corrupt-<time>` instead of being overwritten; files from a newer Tessel are refused.

- `settings.json`: Allow phones, port
- `devices.json`: paired devices (SHA-256 of each token, never the token)
- `profiles/<id>.json`: one per profile, with pages, tiles, graphs and global variables. The editor saves layout and graphs; variables are left as tiles last set them.
- `profiles/index.json`: profile order and which one phones use.
- `plugins.json`: which plugins are on, their settings, and permissions you allowed.
- `plugins/<id>/`: installed plugins. `plugin-data/<id>.json`: each plugin's storage.

Set `TESSEL_DATA_DIR` to use a different folder (handy for testing without touching your tiles).

## Security

- The server listens on `0.0.0.0` only while **Allow phones** is on.
- Pairing codes expire after 5 minutes and work once. Wrong guesses are rate-limited per IP and the code is replaced after 20 failures in total.
- Requests need a LAN-style `Host` (IP, `localhost` or `*.local`) and, for pairing and WebSocket, a matching `Origin`.
- Phones can only send press events for tile ids that exist. They never receive tile graphs.
- **Secure connection** (Phones tab, off by default) adds `https://` and `wss://` on the same port. Tessel makes its own certificate authority for this computer (kept in the data folder, key readable only by you) and a server certificate for its current addresses, renewed when they change. Each phone installs the CA once from `http://<computer>:<port>/tessel-ca.crt`. Plain `http://` keeps working for phones that haven't, and for the iPhone app.
- **Plugins are sandboxed** with Node's permission model. A plugin can read only its own folder and can't write files, start programs, load native code or start workers, unless its manifest asks for `filesystem` or `shell` and you allowed it. Plugins that need `native` code run without the sandbox (native code can step around it), and Tessel says so when asking.

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

**Typing does nothing on Linux**: Wayland blocks the usual way of simulating keys, so on Wayland Tessel uses `ydotool` for typing, shortcuts, media keys and the mouse. Install it (for example `sudo apt install ydotool`) and keep the `ydotoold` service running; Settings shows a reminder when you're on Wayland. On X11 nothing extra is needed.

**Dark mode on Linux** uses GNOME's `color-scheme` setting. Other desktops aren't supported yet. On Windows some apps only notice the change after they restart.

**The iPhone app doesn't find the computer**: allow Local Network for Tessel in the iPhone's Settings › Privacy & Security › Local Network, and check both are on the same Wi-Fi. You can always type the address shown under the QR code. Tessel advertises itself as `<computer name>.local`, so VPN or custom hostnames don't get in the way.

**"Untrusted Developer" or the iPhone app won't open after a week**: see steps 5 and the 7-day note under [iPhone app](#iphone-app-optional).

**"Port 4747 is already used by another app"**: another Tessel or app holds the port. Quit it and toggle Allow phones.

**Screen turns off on the phone**: in Safari, the Wake Lock API needs HTTPS, which plain LAN HTTP isn't. The iPhone app keeps the screen on; otherwise change the phone's auto-lock setting.

## Known limits

- **Tested on macOS only.** The Windows and Linux adapters (apps, volume, brightness, dark mode, lock, sleep, Voicemeeter, ydotool) are covered by tests that mock the OS calls; CI runs the test suite on all three OSes, but the real calls haven't been tried on those systems yet.
- **Voicemeeter** is tested against a mock of its API, not real Voicemeeter.
- **The iPhone app** was run in the iOS simulator (discovery, connecting, the phone page and its native bridge), not yet on a physical iPhone.
- **Plugin network access** isn't limited: the Node in Electron 45 has no network permission yet. Tessel passes `--allow-net` for plugins that declare `network` once it does. Plugins declaring `native` aren't sandboxed.
- **Secure connection** needs a one-time certificate install on each phone (iPhone also needs it turned on under Certificate Trust Settings), and phones pair again on the `https://` address. Without it, Safari over plain `http://` gives no Wake Lock. There is no service worker either way: the phone page needs the computer to be useful.
- No haptics in Safari (no Vibration API); the iPhone app has them.
- The server runs in Electron's main process. It's small; it moves to a utility process if it ever gets heavy.
- Typing non-ASCII text (accents, emoji) goes through the clipboard: Tessel pastes it, then restores what was there before.
- Windows volume and mute take about a second per change (PowerShell compiles a small Core Audio helper each time).

## License

[MIT](LICENSE)
