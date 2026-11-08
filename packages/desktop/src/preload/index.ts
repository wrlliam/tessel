import { contextBridge, ipcRenderer } from 'electron'
import type { EngineEvent } from '@tessel/core'
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
  getBlocks: () => ipcRenderer.invoke(Channel.getBlocks),
  getProfile: () => ipcRenderer.invoke(Channel.getProfile),
  saveProfile: (profile) => ipcRenderer.invoke(Channel.saveProfile, profile),
  validateGraph: (graph) => ipcRenderer.invoke(Channel.validateGraph, graph),
  testRun: (tileId) => ipcRenderer.invoke(Channel.testRun, tileId),
  stopTile: (tileId) => ipcRenderer.invoke(Channel.stopTile, tileId),
  onEngineEvent: (listener) => {
    const handler = (_: unknown, event: EngineEvent) => listener(event)
    ipcRenderer.on(Channel.engineEvent, handler)
    return () => ipcRenderer.off(Channel.engineEvent, handler)
  },
}

contextBridge.exposeInMainWorld('tessel', api)
