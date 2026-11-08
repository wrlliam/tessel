// JSON-RPC style messages between Tessel and a plugin process.
import type { BlockResult, FieldDef, OS, PortDef } from './types.ts'

export interface BlockDescriptor {
  id: string
  name: string
  description: string
  platforms?: OS[]
  inputs: PortDef[]
  outputs: PortDef[]
  fields?: FieldDef[]
  defaults?: Record<string, unknown>
}

export interface Description {
  blocks: BlockDescriptor[]
  triggers: Array<Omit<BlockDescriptor, 'inputs'>>
}

export interface Subscription {
  id: string
  trigger: string
  tileId: string
  params: Record<string, unknown>
}

export interface HostMethods {
  init: { params: { pluginId: string; os: OS; settings: Record<string, unknown> }; result: null }
  describe: { params: null; result: Description }
  run: {
    params: {
      callId: string
      block: string
      tileId: string
      params: Record<string, unknown>
      input: Record<string, unknown>
    }
    result: BlockResult
  }
  cancel: { params: { callId: string }; result: null }
  subscribe: { params: { subscriptions: Subscription[] }; result: null }
  settings: { params: { settings: Record<string, unknown> }; result: null }
  shutdown: { params: null; result: null }
}

export interface PluginMethods {
  'storage.get': { params: { key: string }; result: unknown }
  'storage.set': { params: { key: string; value: unknown }; result: null }
  'storage.delete': { params: { key: string }; result: null }
}

export type Notification =
  | { method: 'log'; params: { level: 'info' | 'warn' | 'error'; message: string } }
  | { method: 'event'; params: { subscriptionId: string; values: Record<string, unknown> } }
  | {
      method: 'tileState'
      params: { callId?: string; tileId?: string; key: string; value: unknown }
    }

export interface Request {
  id: number
  method: string
  params: unknown
}

export type Response = { id: number; result: unknown } | { id: number; error: { message: string } }

export type Message = Request | Response | Notification

export const isResponse = (m: Message): m is Response =>
  'id' in m && ('result' in m || 'error' in m)
export const isRequest = (m: Message): m is Request => 'id' in m && 'method' in m
