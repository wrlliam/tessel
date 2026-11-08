import { Menu, Tray, nativeImage } from 'electron'
import type { DesktopState } from '../shared/api.ts'
import { resource } from './paths.ts'

export interface TrayActions {
  open(): void
  setAllowPhones(on: boolean): void
  setPaused(on: boolean): void
  setStartOnLogin(on: boolean): void
  quit(): void
}

function icon(connected: boolean) {
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(
      resource(connected ? 'trayConnectedTemplate.png' : 'trayTemplate.png'),
    )
    image.setTemplateImage(true)
    return image
  }
  return nativeImage.createFromPath(
    resource(connected ? 'tray-connected-light.png' : 'tray-light.png'),
  )
}

export function statusLine(state: DesktopState): string {
  if (state.serverError) return 'Not sharing: see Tessel window'
  if (!state.listening) return 'Phones off'
  const online = state.devices.filter((d) => d.online).length
  if (online === 0) return `Waiting for phones on port ${state.port}`
  return online === 1 ? '1 phone connected' : `${online} phones connected`
}

export class TesselTray {
  private tray: Tray
  private connected = false

  constructor(private actions: TrayActions) {
    this.tray = new Tray(icon(false))
    this.tray.setToolTip('Tessel')
    // On Windows and Linux a click usually means "open".
    if (process.platform !== 'darwin') this.tray.on('click', () => actions.open())
  }

  update(state: DesktopState) {
    const connected = state.devices.some((d) => d.online)
    if (connected !== this.connected) {
      this.connected = connected
      this.tray.setImage(icon(connected))
    }
    const { actions } = this
    const menu: Electron.MenuItemConstructorOptions[] = [
      { label: statusLine(state), enabled: false },
      { type: 'separator' },
      { label: 'Open Tessel', click: () => actions.open() },
      {
        label: 'Allow phones',
        type: 'checkbox',
        checked: state.allowPhones,
        click: (item) => actions.setAllowPhones(item.checked),
      },
      {
        label: 'Pause all tiles',
        type: 'checkbox',
        checked: state.paused,
        click: (item) => actions.setPaused(item.checked),
      },
    ]
    if (state.startOnLogin !== null) {
      menu.push({
        label: 'Start on login',
        type: 'checkbox',
        checked: state.startOnLogin,
        click: (item) => actions.setStartOnLogin(item.checked),
      })
    }
    menu.push({ type: 'separator' }, { label: 'Quit Tessel', click: () => actions.quit() })
    this.tray.setContextMenu(Menu.buildFromTemplate(menu))
  }
}
