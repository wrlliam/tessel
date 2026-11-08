# Changelog

## Unreleased

- **Pair by scanning** the QR code; no code to type.
- **First run asks what Tessel is for** and adds matching ready-made pages.
- **Edit keys on the phone:** name, colour, icon and swapping places (never what keys do).
- **Shortcut links** run a tile from the iPhone Lock Screen, Action button, Back Tap or Siri (or Android shortcut apps).
- **Editor:** Try mode presses tiles from the desktop; tiles that won't run get a badge; the grid shows edits straight away.
- **My blocks return several values by name** (`return { days, words }`, with `next` to pick the output), type-checked against `values`.
- **Every push to main is released** by CI with installers for macOS, Windows and Linux; installed copies update themselves.
- **zx** for scripts: the Run a zx script block, and zx ready to import in My blocks.
- **.tel files** to share tiles or a whole page, including the code of the My blocks they use; double-click, drop or import to add them.
- **Key styles:** Outline and Glass, Rounded/Square/Round shapes, icon sizes, lights on or off, and a per-tile style.
- **Your own blocks in TypeScript** (Plugins › Create my blocks folder): settings, inputs, several outputs, npm packages and a std library; reload on save, no build step.
- **Plugins:** Home Assistant, Soundpad, Ollama and Google (search links and Gemini).
- **Pop-ups** on the computer's screen, and **Changed?** to react once, e.g. to a new song.
- **Sliders** on the phone, with On slide; **live tiles** for weather, what's playing (with time left), countdowns and a clock.
- **Templates:** 86 tiles in groups (Voicemeeter, Soundpad, Home, AI and search, sliders, live tiles) and 7 ready-made pages.
- **Phone:** keys reflow sideways and the page bar moves to the side; keep-awake works over plain http; optional location for weather.
- **Editor:** delete tiles with Delete or a right-click menu; drag to select several blocks and right-click to duplicate, copy or delete; easier new pages.
- **App:** first-run tour, starts hidden at login, checks GitHub for updates.
- **Fixes:** timers longer than 30 s were cut off; the first Discord mute template didn't focus Discord (old tiles are fixed on load).

## 0.1.0

- **Secure connection (HTTPS).** Optional, on the Phones tab. Serves `https://` and `wss://` on the same port as `http://`, with a local certificate authority per install and a server certificate renewed when the computer's addresses change. Phones install the CA once from `/tessel-ca.crt`; Safari can then keep the screen on.
- **Plugin sandbox.** Plugins run under Node's permission model: by default they can read only their own folder and can't write files, start programs, load native code or start workers. `filesystem` and `shell` in the manifest lift those limits. `native` plugins run without the sandbox, and the permission prompt says so.
- Plugins now run as Tessel's own binary in Node mode rather than as Electron utility processes, which ignore Node's permission flags.

- First release: pairing, the block editor, pages, folders and profiles, system settings, plugins (System info, Voicemeeter), templates, phone settings from the desktop, macOS and Windows installers, and the iPhone app.
