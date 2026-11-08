# Changelog

## 0.1.0

- **Secure connection (HTTPS).** Optional, on the Phones tab. Serves `https://` and `wss://` on the same port as `http://`, with a local certificate authority per install and a server certificate renewed when the computer's addresses change. Phones install the CA once from `/tessel-ca.crt`; Safari can then keep the screen on.
- **Plugin sandbox.** Plugins run under Node's permission model: by default they can read only their own folder and can't write files, start programs, load native code or start workers. `filesystem` and `shell` in the manifest lift those limits. `native` plugins run without the sandbox, and the permission prompt says so.
- Plugins now run as Tessel's own binary in Node mode rather than as Electron utility processes, which ignore Node's permission flags.

- First release: pairing, the block editor, pages, folders and profiles, system settings, plugins (System info, Voicemeeter), templates, phone settings from the desktop, macOS and Windows installers, and the iPhone app.
