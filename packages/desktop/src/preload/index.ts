import { contextBridge, ipcRenderer } from 'electron'
import { Channel, type DesktopState, type TesselApi } from '../shared/api.ts'

const api: TesselApi = {
  getState: () => ipcRenderer.invoke(Channel.getState),
  onState: (listener) => {
    const handler = (_: unknown, state: DesktopState) => listener(state)
    ipcRenderer.on(Channel.state, handler)
    return () => ipcRenderer.off(Channel.state, handler)
  },
  setAllowPhones: (on) => ipcRenderer.invoke(Channel.setAllowPhones, on),
  setPaused: (on) => ipcRenderer.invoke(Channel.setPaused, on),
  setStartOnLogin: (on) => ipcRenderer.invoke(Channel.setStartOnLogin, on),
  newPairingCode: () => ipcRenderer.invoke(Channel.newPairingCode),
  revokeDevice: (id) => ipcRenderer.invoke(Channel.revokeDevice, id),
}

contextBridge.exposeInMainWorld('tessel', api)
