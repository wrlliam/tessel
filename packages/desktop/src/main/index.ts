import { mdnsNames } from '@tessel/server'
import { app, ipcMain } from 'electron'
import { hostname } from 'node:os'
import { Channel, type DesktopState } from '../shared/api.ts'
import { Hub } from './hub.ts'
import { phoneDir } from './paths.ts'
import { createPlatform, isWayland } from './platform/index.ts'
import { confirmPermissions, utilitySpawner, watchFolder } from './plugins/electron.ts'
import { pluginRunner, builtinPluginsDir } from './paths.ts'
import { addPluginWithDialog } from './plugins/dialogs.ts'
import { exportWithDialog, importWithDialog } from './transfer-dialogs.ts'
import { TesselTray } from './tray.ts'
import { currentWindow, markQuitting, showWindow } from './window.ts'

// Lets tests and side-by-side installs use their own settings, devices and profiles.
const dataDirOverride = process.env['TESSEL_DATA_DIR']
if (dataDirOverride) app.setPath('userData', dataDirOverride)

// Electron has no login-item API on Linux; hide the option there.
const loginItemsSupported = process.platform === 'darwin' || process.platform === 'win32'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  void app.whenReady().then(start)
}

async function start() {
  const hub: Hub = new Hub({
    dataDir: app.getPath('userData'),
    phoneDir: phoneDir(),
    // Read when a shell block runs, after the hub exists.
    platform: createPlatform(() => hub.shellPolicy()),
    plugins: {
      spawn: utilitySpawner(pluginRunner()),
      builtinDirs: [builtinPluginsDir()],
      confirmPermissions,
      watch: watchFolder,
    },
    // Tessel answers multicast DNS for this .local name, so the URL survives DHCP changes.
    localHostname: mdnsNames(hostname()).host,
  })

  const state = (): DesktopState => ({
    ...hub.state(),
    platform: process.platform,
    ...(isWayland() && {
      inputNote:
        'You are on Wayland, which blocks the usual way of simulating keys. Tessel uses ydotool instead: install it and keep the ydotoold service running for Type text, Key combo, Media key and Mouse blocks.',
    }),
    startOnLogin: loginItemsSupported ? app.getLoginItemSettings().openAtLogin : null,
  })

  const setStartOnLogin = (on: boolean) => {
    if (!loginItemsSupported) return
    app.setLoginItemSettings({ openAtLogin: on })
    broadcast()
  }

  const quit = () => {
    markQuitting()
    app.quit()
  }

  const tray = new TesselTray({
    open: () => showWindow(),
    setAllowPhones: (on) => void hub.setAllowPhones(on),
    setPaused: (on) => hub.setPaused(on),
    setStartOnLogin,
    setActiveProfile: (id) => void hub.setActiveProfile(id),
    quit,
  })

  function broadcast() {
    const s = state()
    tray.update(s)
    currentWindow()?.webContents.send(Channel.state, s)
  }
  hub.onChange(broadcast)
  hub.onEngineEvent((event) => currentWindow()?.webContents.send(Channel.engineEvent, event))

  ipcMain.handle(Channel.getState, () => state())
  ipcMain.handle(Channel.setAllowPhones, (_e, on: unknown) => hub.setAllowPhones(on === true))
  ipcMain.handle(Channel.setPaused, (_e, on: unknown) => hub.setPaused(on === true))
  ipcMain.handle(Channel.setStartOnLogin, (_e, on: unknown) => setStartOnLogin(on === true))
  ipcMain.handle(Channel.updateSettings, (_e, patch: unknown) =>
    patch && typeof patch === 'object'
      ? hub.updateSettings(patch)
      : { ok: false, error: 'Nothing to change' },
  )
  ipcMain.handle(Channel.newPairingCode, () => hub.newPairingCode())
  ipcMain.handle(Channel.revokeDevice, (_e, id: unknown) => {
    if (typeof id === 'string') return hub.revokeDevice(id)
  })
  const str = (v: unknown): v is string => typeof v === 'string'
  ipcMain.handle(Channel.getBlocks, () => hub.blocks())
  ipcMain.handle(Channel.getProfile, (_e, id: unknown) =>
    str(id) ? hub.getProfile(id) : undefined,
  )
  ipcMain.handle(Channel.saveProfile, (_e, profile: unknown) => hub.saveProfile(profile))
  ipcMain.handle(Channel.createProfile, (_e, name: unknown) =>
    hub.createProfile(str(name) ? name : ''),
  )
  ipcMain.handle(Channel.duplicateProfile, (_e, id: unknown) =>
    str(id) ? hub.duplicateProfile(id) : undefined,
  )
  ipcMain.handle(Channel.deleteProfile, (_e, id: unknown) =>
    str(id) ? hub.deleteProfile(id) : false,
  )
  ipcMain.handle(Channel.setActiveProfile, (_e, id: unknown) =>
    str(id) ? hub.setActiveProfile(id) : undefined,
  )
  ipcMain.handle(Channel.exportProfile, (_e, id: unknown) =>
    str(id) ? exportWithDialog(hub, currentWindow(), id) : false,
  )
  ipcMain.handle(Channel.importProfile, () => importWithDialog(hub, currentWindow()))
  ipcMain.handle(Channel.addVariables, (_e, profileId: unknown, values: unknown) => {
    if (str(profileId) && values && typeof values === 'object') {
      const safe = Object.fromEntries(
        Object.entries(values).filter(
          ([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
        ),
      )
      hub.addVariables(profileId, safe)
    }
  })
  ipcMain.handle(Channel.setPluginEnabled, async (_e, id: unknown, on: unknown) => {
    if (!str(id)) return { ok: false, error: 'Unknown plugin' }
    await hub.plugin().setEnabled(id, on === true)
    return { ok: true }
  })
  ipcMain.handle(Channel.restartPlugin, (_e, id: unknown) =>
    str(id) ? hub.plugin().restart(id) : undefined,
  )
  ipcMain.handle(Channel.removePlugin, (_e, id: unknown) =>
    str(id) ? hub.plugin().remove(id) : undefined,
  )
  ipcMain.handle(Channel.addPlugin, (_e, kind: unknown) =>
    kind === 'folder' || kind === 'zip' || kind === 'dev'
      ? addPluginWithDialog(hub.plugin(), currentWindow(), kind)
      : undefined,
  )
  ipcMain.handle(Channel.updatePluginSettings, (_e, id: unknown, values: unknown) =>
    str(id) && values && typeof values === 'object'
      ? hub.plugin().updateSettings(id, values as Record<string, unknown>)
      : undefined,
  )
  ipcMain.handle(Channel.updatePhoneSettings, (_e, patch: unknown) =>
    patch && typeof patch === 'object'
      ? hub.updatePhoneSettings(patch)
      : { ok: false, error: 'Nothing to change' },
  )
  ipcMain.handle(Channel.validateGraph, (_e, graph: unknown) => hub.checkGraph(graph))
  ipcMain.handle(Channel.testRun, (_e, profileId: unknown, tileId: unknown) => {
    if (str(profileId) && str(tileId)) return hub.testRun(profileId, tileId)
  })
  ipcMain.handle(Channel.stopTile, (_e, profileId: unknown, tileId: unknown) => {
    if (str(profileId) && str(tileId)) hub.stopTile(profileId, tileId)
  })

  await hub.init()
  broadcast()
  showWindow()

  // Keep running in the tray when the window closes.
  app.on('window-all-closed', () => {})
  app.on('activate', () => showWindow())
  let disposed = false
  app.on('before-quit', (e) => {
    markQuitting()
    if (disposed) return
    e.preventDefault()
    disposed = true
    // Give phones a clean close, but never let cleanup block quitting.
    const deadline = new Promise((resolve) => setTimeout(resolve, 2000))
    void Promise.race([hub.dispose(), deadline]).finally(() => app.exit(0))
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, quit)
}
