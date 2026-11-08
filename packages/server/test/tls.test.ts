import { sampleProfile } from '@tessel/core'
import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { ensureTls, serverCertFits } from '../src/certs.ts'
import { DeviceRegistry } from '../src/devices.ts'
import { PairingCodes } from '../src/pairing.ts'
import { TesselServer, type TlsCredentials } from '../src/server.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'tessel-tls-'))

describe('local certificates', () => {
  it('creates a CA and a server certificate for the given addresses', async () => {
    const dir = await tempDir()
    const tls = await ensureTls(dir, ['10.0.0.5', 'studio.local'])
    const cert = new X509Certificate(tls.cert)
    expect(cert.checkIssued(new X509Certificate(tls.ca))).toBe(true)
    expect(cert.checkIP('10.0.0.5')).toBe('10.0.0.5')
    expect(cert.checkHost('studio.local')).toBe('studio.local')
    expect(cert.checkIP('127.0.0.1')).toBe('127.0.0.1')
    const days = (new Date(cert.validTo).getTime() - Date.now()) / 86_400_000
    expect(days).toBeLessThanOrEqual(398)
    expect(new X509Certificate(tls.ca).ca).toBe(true)
    if (process.platform !== 'win32')
      expect((await stat(join(dir, 'ca.key'))).mode & 0o777).toBe(0o600)
  })

  it('keeps the CA and reuses the server certificate until the addresses change', async () => {
    const dir = await tempDir()
    const first = await ensureTls(dir, ['10.0.0.5'])
    const again = await ensureTls(dir, ['10.0.0.5'])
    expect(again.cert).toBe(first.cert)
    const moved = await ensureTls(dir, ['192.168.1.20'])
    expect(moved.cert).not.toBe(first.cert)
    expect(moved.ca).toBe(first.ca)
    expect(serverCertFits(moved.cert, moved.ca, ['192.168.1.20'])).toBe(true)
    expect(serverCertFits(moved.cert, moved.ca, ['10.0.0.5'])).toBe(false)
    expect(await readFile(join(dir, 'ca.crt'), 'utf8')).toBe(first.ca)
  })

  it('renews a server certificate close to expiry', async () => {
    const tls = await ensureTls(await tempDir(), ['10.0.0.5'])
    const nearEnd = Date.now() + 380 * 86_400_000
    expect(serverCertFits(tls.cert, tls.ca, ['10.0.0.5'], nearEnd)).toBe(false)
  })
})

describe('https on the same port', () => {
  let server: TesselServer
  let tls: TlsCredentials
  let port: number

  const start = async () => {
    const dir = await tempDir()
    const devices = new DeviceRegistry(join(dir, 'devices.json'))
    await devices.load()
    tls = await ensureTls(join(dir, 'tls'), ['127.0.0.1'])
    server = new TesselServer({
      devices,
      pairing: new PairingCodes(),
      profile: sampleProfile,
      phoneDir: join(dir, 'missing'),
      logger: { info() {}, warn() {}, error() {} },
      mdns: false,
    })
    server.setTls(tls)
    port = await server.start(0, '127.0.0.1')
  }
  afterEach(() => server.dispose())

  const getHttps = (path: string, ca: string) =>
    new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, ca }, (res) => {
        let body = ''
        res.on('data', (d: Buffer) => (body += d.toString()))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            type: String(res.headers['content-type']),
          }),
        )
      })
      req.on('error', reject)
      req.end()
    })

  it('answers https and http on one port', async () => {
    await start()
    const secure = await getHttps('/api/health', tls.ca)
    expect(secure.status).toBe(200)
    expect(JSON.parse(secure.body)).toMatchObject({ ok: true })
    const plain = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(plain.status).toBe(200)
  })

  it('offers the CA certificate for phones to install', async () => {
    await start()
    const res = await fetch(`http://127.0.0.1:${port}/tessel-ca.crt`)
    expect(res.headers.get('content-type')).toContain('application/x-x509-ca-cert')
    expect(await res.text()).toBe(tls.ca)
  })

  it('refuses https from a client that does not trust the CA', async () => {
    await start()
    await expect(getHttps('/api/health', '')).rejects.toThrow()
  })

  it('upgrades WebSockets over TLS', async () => {
    await start()
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, {
      ca: tls.ca,
      headers: { origin: `https://127.0.0.1:${port}` },
    })
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    ws.close()
  })

  it('stops serving https when TLS is turned off', async () => {
    await start()
    server.setTls(undefined)
    const res = await fetch(`http://127.0.0.1:${port}/tessel-ca.crt`)
    expect(res.status).toBe(404)
    await expect(getHttps('/api/health', tls.ca)).rejects.toThrow()
  })
})
