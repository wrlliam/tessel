import { mdnsNames } from '@tessel/server'
import { shell, app, ipcMain } from 'electron'
import { hostname } from 'node:os'
import { Channel, type DesktopState, type SharedTiles } from '../shared/api.ts'
import { Hub } from './hub.ts'
import { phoneDir } from './paths.ts'
import { createPlatform, isWayland } from './platform/index.ts'
import { confirmPermissions, pluginSpawner, watchFolder } from './plugins/electron.ts'
import { pluginRunner, builtinPluginsDir } from './paths.ts'
import { addPluginWithDialog } from './plugins/dialogs.ts'
import { exportWithDialog, importWithDialog } from './transfer-dialogs.ts'
import { TesselTray } from './tray.ts'
import { Updater } from './updater.ts'
import QRCode from 'qrcode'
import { ensureMyBlocks, ensurePackage, newBlockFile } from './custom-blocks.ts'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { MY_BLOCKS_FILES, STARTER } from './custom-blocks-files.ts'
import { exportTelWithDialog, importTelWithDialog } from './tel-dialogs.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { currentWindow, markQuitting, showWindow } from './window.ts'

// Lets tests and side-by-side installs use their own settings, devices and profiles.
const dataDirOverride = process.env['TESSEL_DATA_DIR']
if (dataDirOverride) app.setPath('userData', dataDirOverride)

// Electron has no login-item API on Linux; hide the option there.
const loginItemsSupported = process.platform === 'darwin' || process.platform === 'win32'

// .tel files can arrive before Tessel is ready: from Finder (open-file) or as a launch argument.
const pendingTel: string[] = []
let telHandler: ((path: string) => void) | undefined
const telArg = (argv: string[]) => argv.find((a) => a.toLowerCase().endsWith('.tel'))
const receiveTel = (path: string) => (telHandler ? telHandler(path) : pendingTel.push(path))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('open-file', (e, path) => {
    e.preventDefault()
    receiveTel(path)
  })
  const first = telArg(process.argv)
  if (first) pendingTel.push(first)
  app.on('second-instance', (_e, argv) => {
    const tel = telArg(argv)
    if (tel) receiveTel(tel)
    else showWindow()
  })
  void app.whenReady().then(start)
}

async function start() {
  const hub: Hub = new Hub({
    dataDir: app.getPath('userData'),
    phoneDir: phoneDir(),
    // Read when a shell block runs, after the hub exists.
    platform: createPlatform(() => hub.shellPolicy()),
    plugins: {
      spawn: pluginSpawner(pluginRunner()),
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
    version: app.getVersion(),
    myBlocksDir: existsSync(join(app.getPath('userData'), 'my-blocks', 'manifest.json'))
      ? join(app.getPath('userData'), 'my-blocks')
      : undefined,
    update: updater.state,
  })
  const updater = new Updater(() => broadcast())
  updater.start(() => hub.state().settings.autoUpdate)

  const setStartOnLogin = (on: boolean) => {
    if (!loginItemsSupported) return
    // Started at login, Tessel waits in the tray/menu bar instead of opening its window.
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
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
  hub.onPhoneEdit((edit) => currentWindow()?.webContents.send(Channel.phoneEdit, edit))

  ipcMain.handle(Channel.getState, () => state())
  ipcMain.handle(Channel.setAllowPhones, (_e, on: unknown) => hub.setAllowPhones(on === true))
  ipcMain.handle(Channel.setPaused, (_e, on: unknown) => hub.setPaused(on === true))
  ipcMain.handle(Channel.setStartOnLogin, (_e, on: unknown) => setStartOnLogin(on === true))
  ipcMain.handle(Channel.updateSettings, (_e, patch: unknown) =>
    patch && typeof patch === 'object'
      ? hub.updateSettings(patch)
      : { ok: false, error: 'Nothing to change' },
  )
  ipcMain.handle(Channel.checkForUpdate, () => updater.check())
  ipcMain.handle(Channel.installUpdate, () => {
    markQuitting()
    updater.install()
  })
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
  // My blocks: TypeScript blocks in a folder next to Tessel's data, run as a dev plugin.
  const myBlocksDir = join(app.getPath('userData'), 'my-blocks')
  const myBlocksReady = () => existsSync(join(myBlocksDir, 'manifest.json'))
  // zx ships with Tessel; My blocks gets its own copy so blocks can import it without npm.
  const zxDir = dirname(createRequire(import.meta.url).resolve('zx/package.json'))
  const setUpMyBlocks = async () => {
    await ensureMyBlocks(myBlocksDir, MY_BLOCKS_FILES)
    await ensurePackage(myBlocksDir, 'zx', zxDir)
  }
  if (myBlocksReady()) void setUpMyBlocks().catch(() => {})
  ipcMain.handle(Channel.createMyBlocks, async () => {
    try {
      await setUpMyBlocks()
      if (
        !hub
          .plugin()
          .list()
          .some((p) => p.id === 'my-blocks')
      )
        await hub.plugin().addDev(myBlocksDir)
      broadcast()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(Channel.openMyBlocks, () => shell.openPath(myBlocksDir).then(() => undefined))
  ipcMain.handle(Channel.newMyBlock, async (_e, name: unknown) => {
    const file = await newBlockFile(
      myBlocksDir,
      typeof name === 'string' ? name.slice(0, 60) : '',
      STARTER,
    )
    await shell.openPath(file)
  })
  ipcMain.handle(Channel.createShortcut, async (_e, profileId: unknown, tileId: unknown) => {
    if (typeof profileId !== 'string' || typeof tileId !== 'string') return undefined
    const made = await hub.createShortcut(profileId, tileId)
    if (!made) return undefined
    const urls = hub.state().urls.map((u) => `${u}run/${made.key}`)
    const qr = urls[0]
      ? await QRCode.toDataURL(urls[0], {
          margin: 1,
          width: 360,
          color: { dark: '#0E1116', light: '#F4F6F8' },
        })
      : ''
    return { id: made.id, urls, qr }
  })
  ipcMain.handle(Channel.deleteShortcut, (_e, id: unknown) =>
    typeof id === 'string' ? hub.deleteShortcut(id) : undefined,
  )
  ipcMain.handle(Channel.exportTel, (_e, req: unknown) => {
    const r = req as SharedTiles | undefined
    if (!r || typeof r.name !== 'string' || !Array.isArray(r.tiles))
      return { ok: false, error: 'Nothing to share' }
    return exportTelWithDialog(currentWindow(), hub, myBlocksDir, r)
  })
  ipcMain.handle(Channel.importTel, (_e, path: unknown) =>
    importTelWithDialog(
      currentWindow(),
      hub,
      myBlocksDir,
      setUpMyBlocks,
      typeof path === 'string' && path.endsWith('.tel') ? path : undefined,
    ),
  )
  // .tel files opened from Finder or Explorer go to the editor, which asks before adding them.
  const openTel = (path: string) => {
    const win = showWindow()
    const send = () => win.webContents.send(Channel.telOpened, path)
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
  for (const p of pendingTel.splice(0)) openTel(p)
  telHandler = openTel
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
  ipcMain.handle(Channel.finishTour, () => hub.finishTour())
  ipcMain.handle(Channel.validateGraph, (_e, graph: unknown) => hub.checkGraph(graph))
  ipcMain.handle(Channel.testRun, (_e, profileId: unknown, tileId: unknown) => {
    if (str(profileId) && str(tileId)) return hub.testRun(profileId, tileId)
  })
  ipcMain.handle(Channel.trySlide, (_e, profileId: unknown, tileId: unknown, value: unknown) => {
    if (str(profileId) && str(tileId) && typeof value === 'number' && Number.isFinite(value))
      return hub.trySlide(profileId, tileId, value)
  })
  ipcMain.handle(Channel.stopTile, (_e, profileId: unknown, tileId: unknown) => {
    if (str(profileId) && str(tileId)) hub.stopTile(profileId, tileId)
  })

  await hub.init()
  broadcast()
  const atLogin =
    process.argv.includes('--hidden') ||
    (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
  if (!atLogin) showWindow()

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
