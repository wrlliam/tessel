import { BrowserWindow, Notification, shell } from 'electron'
import { resource } from './paths.ts'
import { fileURLToPath } from 'node:url'

let win: BrowserWindow | undefined
let quitting = false
let toldAboutTray = false

export const markQuitting = () => (quitting = true)

export function showWindow() {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Tessel',
    backgroundColor: '#0E1116',
    // macOS uses the app bundle's icon; Windows and Linux need one for the window.
    ...(process.platform !== 'darwin' && { icon: resource('icon.png') }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win?.show())

  // The renderer never navigates; send links to the browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Closing hides to the tray; Quit in the tray menu really quits.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true
      new Notification({
        title: 'Tessel is still running',
        body:
          process.platform === 'darwin'
            ? 'Your phone keeps working. Open Tessel or quit it from the menu bar.'
            : 'Your phone keeps working. Open Tessel or quit it from the tray icon.',
      }).show()
    }
  })
  win.on('closed', () => (win = undefined))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  return win
}

export const currentWindow = () => win
