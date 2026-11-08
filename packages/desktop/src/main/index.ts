import { app, ipcMain } from 'electron'
import { hostname } from 'node:os'
import { Channel, type DesktopState } from '../shared/api.ts'
import { Hub } from './hub.ts'
import { phoneDir } from './paths.ts'
import { createPlatform } from './platform/index.ts'
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
  const hub = new Hub({
    dataDir: app.getPath('userData'),
    phoneDir: phoneDir(),
    platform: createPlatform(),
    // macOS answers mDNS for its own hostname, so this URL survives DHCP changes.
    ...(process.platform === 'darwin' && hostname().endsWith('.local')
      ? { localHostname: hostname() }
      : {}),
  })

  const state = (): DesktopState => ({
    ...hub.state(),
    platform: process.platform,
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
  ipcMain.handle(Channel.newPairingCode, () => hub.newPairingCode())
  ipcMain.handle(Channel.revokeDevice, (_e, id: unknown) => {
    if (typeof id === 'string') return hub.revokeDevice(id)
  })
  ipcMain.handle(Channel.getBlocks, () => hub.blocks())
  ipcMain.handle(Channel.getProfile, () => hub.getProfile())
  ipcMain.handle(Channel.saveProfile, (_e, profile: unknown) => hub.saveProfile(profile))
  ipcMain.handle(Channel.validateGraph, (_e, graph: unknown) => hub.checkGraph(graph))
  ipcMain.handle(Channel.testRun, (_e, id: unknown) => {
    if (typeof id === 'string') return hub.testRun(id)
  })
  ipcMain.handle(Channel.stopTile, (_e, id: unknown) => {
    if (typeof id === 'string') hub.stopTile(id)
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
