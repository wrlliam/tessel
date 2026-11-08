import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createJsonStore, type JsonStore } from './json-store.ts'

const Device = z.object({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string(),
  pairedAt: z.number(),
  lastSeenAt: z.number().nullable(),
})
export type Device = z.infer<typeof Device>
export type DeviceInfo = Omit<Device, 'tokenHash'>

const DevicesFile = z.object({ devices: z.array(Device) })

export const DEVICES_SCHEMA_VERSION = 1

// Tokens are 256 random bits, so a fast hash is enough; slow KDFs only help low-entropy secrets.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export class DeviceRegistry {
  private devices: Device[] = []
  private listeners = new Set<() => void>()
  private store: JsonStore<z.infer<typeof DevicesFile>>
  private now: () => number

  constructor(file: string, now: () => number = Date.now) {
    this.now = now
    this.store = createJsonStore({
      file,
      schemaVersion: DEVICES_SCHEMA_VERSION,
      schema: DevicesFile,
      defaults: () => ({ devices: [] }),
    })
  }

  async load() {
    this.devices = (await this.store.load()).devices
  }

  list(): DeviceInfo[] {
    return this.devices.map(({ tokenHash: _, ...info }) => info)
  }

  async pair(name: string): Promise<{ deviceId: string; token: string }> {
    const token = randomBytes(32).toString('base64url')
    const device: Device = {
      id: randomUUID(),
      name,
      tokenHash: hashToken(token),
      pairedAt: this.now(),
      lastSeenAt: null,
    }
    this.devices.push(device)
    await this.persist()
    return { deviceId: device.id, token }
  }

  verify(token: string): DeviceInfo | undefined {
    const hash = hashToken(token)
    const device = this.devices.find((d) => d.tokenHash === hash)
    if (!device) return undefined
    const { tokenHash: _, ...info } = device
    return info
  }

  async touch(id: string, name?: string) {
    const device = this.devices.find((d) => d.id === id)
    if (!device) return
    device.lastSeenAt = this.now()
    if (name) device.name = name
    await this.persist()
  }

  async revoke(id: string): Promise<boolean> {
    const before = this.devices.length
    this.devices = this.devices.filter((d) => d.id !== id)
    if (this.devices.length === before) return false
    await this.persist()
    return true
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async persist() {
    await this.store.save({ devices: this.devices })
    this.listeners.forEach((l) => l())
  }
}
