# Changelog

## Unreleased

- **Phones need approval:** the pairing code only asks to connect; nothing gets in until you press Approve on the computer. Pairing the same phone again replaces its old entry.
- **Plugins re-ask for permissions** they didn't have when you allowed them, e.g. after a dev plugin's manifest changes.
- **Graphic tiles:** show a number as a ring gauge, bar, line chart or column chart, with colour zones (Inspector › Display, fed by the new **Show a value** block). Charts keep a history (Settings › Charts, 5 minutes to 7 days, oldest dropped first); tap one on the phone to scroll back through it.
- **System stats:** a block for CPU, graphics card, memory, disk and network, gauge and chart templates, and System stats and System usage pages. GPU use comes from ioreg on macOS, nvidia-smi for NVIDIA cards, sysfs for AMD and Intel on Linux, and the GPU Engine counters on Windows; GPU memory and temperature where the card reports them. Readings a computer can't give show as a dash.
- **Ready-made pages can be searched** in the New page menu; the list scrolls instead of running off the screen.
- **Editor:** the tile grid comes first and fits its column; page settings fold away below it.
- **Mic level** is a ring of how loud you are, green to amber to red, instead of a negative dB number.
- **On double tap** trigger, for a second action on the same tile.
- **Schedules run only while a phone shows their page**, unless set to Always.
- **Resizing a tile pushes its neighbours aside**; if they'd leave the grid, the size is refused.
- **Phone preview in the editor:** see the page exactly as the phone draws it, and turn it sideways.
- **Flow editor:** a zoom bar, a map in block colours you can hide, and a run log with timings, failures and a This tile filter.
- **Activity log:** search, filter by warnings or errors, and a bigger view; keeps 1,000 entries.
- **Medal** only says a clip or screenshot is saved once it's in your library, and says why when it isn't.
- **Old Voicemeeter gain sliders** get hold-to-reset-to-0 dB.

- **std.blocks and std.my in My blocks:** call any of Tessel's blocks (pop-up, toggle, set tile appearance, plugin blocks…) and your other custom blocks as typed functions; the list is regenerated whenever the available blocks change.
- **Medal plugin** (Windows): clip, screenshot and record from your phone with Medal's hotkeys, and pop up when a clip is saved.
- **Gaming and Windows templates:** Xbox Game Bar, NVIDIA and AMD replay and recording keys that turn red while recording and pop up to confirm, Steam games and library, a gaming break reminder, and Windows snapping, virtual desktops, snip, clipboard history and more. New pages: Gaming, Medal and Windows.
- **Plugins can press keys** (`ctx.pressKeys`) when they ask for the input permission.
- **DaVinci Resolve:** shortcut keys for playback, editing, markers and pages (no plugin, free version too), a DaVinci Resolve plugin for renders, named markers, page switching and a live timecode tile, and a ready-made Resolve page.
- **App commands wait until the app is really in front** before pressing its shortcut, which fixes Spotify's Like (and others) when the app was hidden or in the background.
- **Pictures on tiles:** choose one in the inspector, or set one at run time; What's playing shows the album cover.
- **Sliders follow changes** made elsewhere (the volume slider tracks the system volume), and can be **tapped and held**: hold a Voicemeeter fader to reset it to 0 dB, or the volume slider to mute.
- **Open app** tiles light up while their app is open; apps open reliably on Windows, and macOS finds apps whose names differ slightly.
- **Get more plugins:** OBS Studio, Philips Hue, Elgato Key Light, macOS Shortcuts, audio output switching, Slack status and Spotify, downloaded on demand and checked before installing.
- **More templates:** OBS scenes, record and go-live keys that light up while live; light switches and sliders; Slack statuses; water and stand-up reminders; night and day mode; meeting prep. New pages: Streaming, Lights and Workday.
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
