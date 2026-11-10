import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  Channel,
  type DesktopState,
  type PhoneEdit,
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
  approvePhone: (id) => ipcRenderer.invoke(Channel.approvePhone, id),
  denyPhone: (id) => ipcRenderer.invoke(Channel.denyPhone, id),
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
  trySlide: (profileId, tileId, value) =>
    ipcRenderer.invoke(Channel.trySlide, profileId, tileId, value),
  setPluginEnabled: (id, on) => ipcRenderer.invoke(Channel.setPluginEnabled, id, on),
  restartPlugin: (id) => ipcRenderer.invoke(Channel.restartPlugin, id),
  removePlugin: (id) => ipcRenderer.invoke(Channel.removePlugin, id),
  addPlugin: (kind) => ipcRenderer.invoke(Channel.addPlugin, kind),
  updatePhoneSettings: (patch) => ipcRenderer.invoke(Channel.updatePhoneSettings, patch),
  finishTour: () => ipcRenderer.invoke(Channel.finishTour),
  checkForUpdate: () => ipcRenderer.invoke(Channel.checkForUpdate),
  installUpdate: () => ipcRenderer.invoke(Channel.installUpdate),
  createMyBlocks: () => ipcRenderer.invoke(Channel.createMyBlocks),
  openMyBlocks: () => ipcRenderer.invoke(Channel.openMyBlocks),
  newMyBlock: (name) => ipcRenderer.invoke(Channel.newMyBlock, name),
  exportTel: (req) => ipcRenderer.invoke(Channel.exportTel, req),
  importTel: (path) => ipcRenderer.invoke(Channel.importTel, path),
  onTelOpened: (listener) => {
    const handler = (_: unknown, path: string) => listener(path)
    ipcRenderer.on(Channel.telOpened, handler)
    return () => ipcRenderer.off(Channel.telOpened, handler)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  createShortcut: (profileId, tileId) =>
    ipcRenderer.invoke(Channel.createShortcut, profileId, tileId),
  deleteShortcut: (id) => ipcRenderer.invoke(Channel.deleteShortcut, id),
  getCatalog: (force) => ipcRenderer.invoke(Channel.getCatalog, force),
  pickTileImage: () => ipcRenderer.invoke(Channel.pickTileImage),
  installFromCatalog: (id) => ipcRenderer.invoke(Channel.installFromCatalog, id),
  onPhoneEdit: (listener) => {
    const handler = (_: unknown, edit: PhoneEdit) => listener(edit)
    ipcRenderer.on(Channel.phoneEdit, handler)
    return () => ipcRenderer.off(Channel.phoneEdit, handler)
  },
  updatePluginSettings: (id, values) =>
    ipcRenderer.invoke(Channel.updatePluginSettings, id, values),
  onEngineEvent: (listener) => {
    const handler = (_: unknown, event: ProfileEngineEvent) => listener(event)
    ipcRenderer.on(Channel.engineEvent, handler)
    return () => ipcRenderer.off(Channel.engineEvent, handler)
  },
}

contextBridge.exposeInMainWorld('tessel', api)
