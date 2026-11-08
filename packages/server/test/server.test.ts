import { CloseCode, PROTOCOL_VERSION, sampleProfile, type ServerMessage } from '@tessel/core'
import { request } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DeviceRegistry } from '../src/devices.ts'
import { PairingCodes } from '../src/pairing.ts'
import { TesselServer, type PressEvent } from '../src/server.ts'

const silent = { info() {}, warn() {}, error() {} }

let server: TesselServer
let devices: DeviceRegistry
let pairing: PairingCodes
let base: string
let presses: PressEvent[]

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tessel-server-'))
  devices = new DeviceRegistry(join(dir, 'devices.json'))
  await devices.load()
  pairing = new PairingCodes()
  presses = []
  server = new TesselServer({
    devices,
    pairing,
    profile: sampleProfile,
    phoneDir: join(dir, 'missing'),
    logger: silent,
    mdns: false,
    onPress: (e) => presses.push(e),
  })
  const port = await server.start(0, '127.0.0.1')
  base = `http://127.0.0.1:${port}`
})

afterEach(() => server.dispose())

const pair = (code: string, origin = base) =>
  fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ code, deviceName: 'Test phone' }),
  })

function connect(origin = base) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { origin } })
  const messages: ServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.on('message', (d) => {
    messages.push(JSON.parse(d.toString()) as ServerMessage)
    waiters.splice(0).forEach((w) => w())
  })
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  const next = async (): Promise<ServerMessage> => {
    while (messages.length === 0) await new Promise<void>((r) => waiters.push(r))
    return messages.shift() as ServerMessage
  }
  return { ws, opened, closed, next, send: (m: object) => ws.send(JSON.stringify(m)) }
}

async function pairedToken() {
  const res = await pair(pairing.get().code)
  return ((await res.json()) as { token: string }).token
}

describe('http', () => {
  it('reports health', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(await res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION })
  })

  it('rejects unknown Host headers (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve) => {
      const url = new URL(`${base}/api/health`)
      request(
        { host: url.hostname, port: url.port, path: url.pathname, headers: { host: 'evil.com' } },
        (res) => resolve(res.statusCode ?? 0),
      ).end()
    })
    expect(status).toBe(421)
  })

  it('explains how to build the phone client when it is missing', async () => {
    const res = await fetch(`${base}/`)
    expect(await res.text()).toContain('pnpm --filter @tessel/phone build')
  })
})

describe('pairing', () => {
  it('rejects a cross-origin pairing request', async () => {
    expect((await pair(pairing.get().code, 'http://evil.com')).status).toBe(403)
  })

  it('rejects a wrong code', async () => {
    const wrong = String((Number(pairing.get().code) + 1) % 1e6).padStart(6, '0')
    expect((await pair(wrong)).status).toBe(401)
  })

  it('rejects a malformed body', async () => {
    expect((await pair('12')).status).toBe(400)
  })

  it('issues a token and stores only its hash', async () => {
    const res = await pair(pairing.get().code)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; deviceId: string }
    expect(body.token).toMatch(/^[\w-]{43}$/)
    expect(devices.list()).toHaveLength(1)
    expect(JSON.stringify(devices.list())).not.toContain(body.token)
  })

  it('rate-limits repeated failures with 429', async () => {
    const wrong = String((Number(pairing.get().code) + 1) % 1e6).padStart(6, '0')
    for (let i = 0; i < 5; i++) await pair(wrong)
    const res = await pair(pairing.get().code)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })
})

describe('websocket', () => {
  it('refuses a cross-origin upgrade', async () => {
    const c = connect('http://evil.com')
    await expect(c.opened).rejects.toThrow(/403/)
  })

  it('closes unauthenticated sockets that skip hello', async () => {
    const c = connect()
    await c.opened
    c.send({ type: 'press', tileId: 'discord', phase: 'down' })
    expect(await c.closed).toBe(CloseCode.unauthorized)
    expect(presses).toEqual([])
  })

  it('rejects an unknown token', async () => {
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'nope', deviceName: 'x' })
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unauthorized' })
    expect(await c.closed).toBe(CloseCode.unauthorized)
  })

  it('rejects a different protocol version', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: 99, token, deviceName: 'x' })
    expect(await c.next()).toMatchObject({ type: 'error', code: 'protocol-mismatch' })
    expect(await c.closed).toBe(CloseCode.protocolMismatch)
  })

  it('sends the profile after hello, forwards presses and answers pings', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, deviceName: 'iPhone' })
    const profile = await c.next()
    expect(profile.type).toBe('profile')
    expect(JSON.stringify(profile)).not.toContain('graph')
    expect(server.phones()).toHaveLength(1)

    c.send({ type: 'press', tileId: 'discord', phase: 'down' })
    c.send({ type: 'press', tileId: 'not-a-tile', phase: 'down' })
    c.send({ type: 'ping', t: 42 })
    expect(await c.next()).toEqual({ type: 'pong', t: 42 })
    expect(presses).toEqual([{ deviceId: devices.list()[0]?.id, tileId: 'discord', phase: 'down' }])
    c.ws.close()
  })

  it('replies with bad-message to invalid input without crashing', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, deviceName: 'iPhone' })
    await c.next()
    c.send({ type: 'shell', command: 'whoami' })
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad-message' })
    c.ws.close()
  })

  it('disconnects a phone when its device is revoked', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, deviceName: 'iPhone' })
    await c.next()
    await devices.revoke(devices.list()[0]?.id ?? '')
    expect(await c.closed).toBe(CloseCode.revoked)
  })

  it('pushes profile updates to connected phones', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, deviceName: 'iPhone' })
    await c.next()
    server.setProfile({ ...sampleProfile, name: 'Gaming' })
    expect(await c.next()).toMatchObject({ type: 'profile', profile: { name: 'Gaming' } })
    c.ws.close()
  })

  it('closes phones when the server stops', async () => {
    const token = await pairedToken()
    const c = connect()
    await c.opened
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, deviceName: 'iPhone' })
    await c.next()
    await server.stop()
    expect(await c.closed).toBe(CloseCode.serverStopping)
    expect(server.running).toBe(false)
  })
})

describe('phone client', () => {
  it('serves files added after start, falls back to index.html for pages and 404s missing assets', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const dir = await mkdtemp(join(tmpdir(), 'tessel-phone-'))
    await writeFile(join(dir, 'index.html'), '<!doctype html><p>phone</p>')
    const s = new TesselServer({
      devices,
      pairing,
      profile: sampleProfile,
      phoneDir: dir,
      logger: silent,
      mdns: false,
    })
    const url = `http://127.0.0.1:${await s.start(0, '127.0.0.1')}`
    try {
      await mkdir(join(dir, 'assets'))
      await writeFile(join(dir, 'assets', 'new.js'), 'export {}')
      const asset = await fetch(`${url}/assets/new.js`)
      expect(asset.headers.get('content-type')).toContain('javascript')
      expect(asset.headers.get('cache-control')).toContain('immutable')

      const page = await fetch(`${url}/some/page`)
      expect(await page.text()).toContain('phone')
      expect(page.headers.get('cache-control')).toBe('no-cache')

      expect((await fetch(`${url}/assets/gone.css`)).status).toBe(404)
    } finally {
      await s.dispose()
    }
  })
})
