import { BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'

let win: BrowserWindow | undefined
let quitting = false

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
  })
  win.on('closed', () => (win = undefined))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  return win
}

export const currentWindow = () => win
