import { contextBridge, ipcRenderer } from 'electron'
import {
  Channel,
  type DesktopState,
  type ProfileEngineEvent,
  type TesselApi,
} from '../shared/api.ts'

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
  updateSettings: (patch) => ipcRenderer.invoke(Channel.updateSettings, patch),
  newPairingCode: () => ipcRenderer.invoke(Channel.newPairingCode),
  revokeDevice: (id) => ipcRenderer.invoke(Channel.revokeDevice, id),
  getBlocks: () => ipcRenderer.invoke(Channel.getBlocks),
  getProfile: (id) => ipcRenderer.invoke(Channel.getProfile, id),
  saveProfile: (profile) => ipcRenderer.invoke(Channel.saveProfile, profile),
  createProfile: (name) => ipcRenderer.invoke(Channel.createProfile, name),
  duplicateProfile: (id) => ipcRenderer.invoke(Channel.duplicateProfile, id),
  deleteProfile: (id) => ipcRenderer.invoke(Channel.deleteProfile, id),
  setActiveProfile: (id) => ipcRenderer.invoke(Channel.setActiveProfile, id),
  exportProfile: (id) => ipcRenderer.invoke(Channel.exportProfile, id),
  importProfile: () => ipcRenderer.invoke(Channel.importProfile),
  addVariables: (profileId, values) => ipcRenderer.invoke(Channel.addVariables, profileId, values),
  validateGraph: (graph) => ipcRenderer.invoke(Channel.validateGraph, graph),
  testRun: (profileId, tileId) => ipcRenderer.invoke(Channel.testRun, profileId, tileId),
  stopTile: (profileId, tileId) => ipcRenderer.invoke(Channel.stopTile, profileId, tileId),
  onEngineEvent: (listener) => {
    const handler = (_: unknown, event: ProfileEngineEvent) => listener(event)
    ipcRenderer.on(Channel.engineEvent, handler)
    return () => ipcRenderer.off(Channel.engineEvent, handler)
  },
}

contextBridge.exposeInMainWorld('tessel', api)
