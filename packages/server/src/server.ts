import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import {
  CloseCode,
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  PairRequest,
  PairWaitRequest,
  parseClientMessage,
  toPhoneProfile,
  type EditTileMessage,
  type PairPending,
  type PairResponse,
  type Profile,
  type ServerMessage,
} from '@tessel/core'
import Bonjour from 'bonjour-service'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { existsSync } from 'node:fs'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { WebSocket } from 'ws'
import type { PairApprovals } from './approvals.ts'
import type { DeviceInfo, DeviceRegistry } from './devices.ts'
import { isAllowedHost, isSameOrigin } from './origin.ts'
import type { PairingCodes } from './pairing.ts'

export const DEFAULT_PORT = 4747
const HELLO_TIMEOUT_MS = 5_000
const HEARTBEAT_MS = 15_000
const MAX_MESSAGES_PER_SECOND = 40
/** How long one /api/pair/wait request is held open before the phone asks again. */
const PAIR_WAIT_MS = 25_000

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface ConnectedPhone {
  deviceId: string
  name: string
  ip: string
}

export interface PressEvent {
  deviceId: string
  tileId: string
  phase: 'down' | 'up' | 'hold'
}

export interface TesselServerOptions {
  devices: DeviceRegistry
  pairing: PairingCodes
  /** Phones with the right code wait here until someone approves them on the computer. */
  approvals: PairApprovals
  profile: Profile
  /** Built phone client. When missing, '/' explains how to build it. */
  phoneDir: string
  logger: Logger
  onPress?: (event: PressEvent) => void
  onPageChange?: (deviceId: string, pageId: string) => void
  /** A slider tile was dragged; value is 0 to 100. */
  onSlide?: (event: { deviceId: string; tileId: string; value: number }) => void
  /** A shortcut link was used. Resolves to what happened, or undefined for an unknown key. */
  onRunKey?: (
    key: string,
  ) => Promise<{ ok: true; tile: string } | { ok: false; error: string } | undefined>
  /** A phone changed a key's look or swapped two keys. */
  onEditTile?: (deviceId: string, edit: Omit<EditTileMessage, 'type'>) => void
  /** A phone shared where it is, after the desktop asked. */
  onLocation?: (deviceId: string, at: { lat: number; lon: number; accuracy?: number }) => void
  onPhonesChanged?: (phones: ConnectedPhone[]) => void
  /** Sent to a phone right after its profile, e.g. live tile states. */
  welcomeMessages?: () => ServerMessage[]
  /** Advertise _tessel._tcp over mDNS. Off in tests. */
  mdns?: boolean
}

/** Certificate the server uses for https:// on the same port, and the CA phones install. */
export interface TlsCredentials {
  key: string
  cert: string
  /** PEM of the CA that signed `cert`, offered at /tessel-ca.crt. */
  ca: string
}

/** First byte of a TLS ClientHello. */
const TLS_HANDSHAKE = 0x16

interface Client {
  socket: WebSocket
  ip: string
  device?: DeviceInfo
  alive: boolean
}

export class TesselServer {
  private app?: FastifyInstance
  private listener?: NetServer
  private sockets = new Set<Socket>()
  private tls?: TlsCredentials
  private https?: HttpsServer
  private bonjour?: Bonjour
  private clients = new Set<Client>()
  private heartbeat?: NodeJS.Timeout
  private profile: Profile
  private unsubscribeDevices: () => void
  port: number | undefined

  constructor(private opts: TesselServerOptions) {
    this.profile = opts.profile
    this.unsubscribeDevices = opts.devices.onChange(() => this.dropRevokedClients())
  }

  get running() {
    return this.app !== undefined
  }

  phones(): ConnectedPhone[] {
    return [...this.clients].flatMap((c) =>
      c.device ? [{ deviceId: c.device.id, name: c.device.name, ip: c.ip }] : [],
    )
  }

  setProfile(profile: Profile) {
    this.profile = profile
    this.broadcast({ type: 'profile', profile: toPhoneProfile(profile) })
  }

  broadcast(message: ServerMessage) {
    const data = JSON.stringify(message)
    for (const c of this.clients) if (c.device) c.socket.send(data)
  }

  /**
   * Serves https:// alongside http:// on the same port, or stops when undefined. Takes effect
   * for new connections straight away, so a renewed certificate needs no restart.
   */
  setTls(tls: TlsCredentials | undefined) {
    this.tls = tls
    if (!tls) this.https = undefined
    else if (this.https) this.https.setSecureContext({ key: tls.key, cert: tls.cert })
    else if (this.app) this.https = this.httpsFor(this.app)
  }

  get secure() {
    return this.tls !== undefined
  }

  private httpsFor(app: FastifyInstance): HttpsServer | undefined {
    if (!this.tls) return undefined
    const server = createHttpsServer({ key: this.tls.key, cert: this.tls.cert })
    // Requests and WebSocket upgrades go to the same Fastify app as plain http.
    server.on('request', (req, res) => app.server.emit('request', req, res))
    server.on('upgrade', (req, socket, head) => app.server.emit('upgrade', req, socket, head))
    server.on('tlsClientError', () => {})
    return server
  }

  /** Listens on all interfaces. Pass port 0 to pick a free one. */
  async start(port = DEFAULT_PORT, host = '0.0.0.0'): Promise<number> {
    if (this.app) return this.port ?? port
    const app = this.build()
    await app.ready()
    this.https = this.httpsFor(app)
    // One port for both: a TLS handshake goes to https, anything else to plain http. Phones that
    // haven't installed the CA, and the iPhone app, keep working over http.
    const listener = createNetServer((socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => socket.destroy())
      socket.once('data', (chunk) => {
        socket.pause()
        socket.unshift(chunk)
        const target = chunk[0] === TLS_HANDSHAKE && this.https ? this.https : app.server
        target.emit('connection', socket)
        process.nextTick(() => socket.resume())
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject)
        listener.listen(port, host, () => {
          listener.off('error', reject)
          resolve()
        })
      })
    } catch (err) {
      await app.close()
      throw err
    }
    this.listener = listener
    const address = listener.address()
    this.port = typeof address === 'object' && address ? address.port : port
    this.app = app
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS)
    if (this.opts.mdns !== false) this.advertise(this.port)
    this.opts.logger.info(`Listening on port ${this.port}`)
    return this.port
  }

  async stop() {
    const app = this.app
    if (!app) return
    this.app = undefined
    this.opts.approvals.clear()
    clearInterval(this.heartbeat)
    for (const c of this.clients)
      c.socket.close(CloseCode.serverStopping, 'Desktop stopped sharing')
    this.clients.clear()
    this.emitPhones()
    await this.unadvertise()
    const listener = this.listener
    this.listener = undefined
    for (const s of this.sockets) s.destroy()
    this.sockets.clear()
    this.https = undefined
    await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()))
    await app.close()
    this.opts.logger.info('Stopped listening')
  }

  async dispose() {
    this.unsubscribeDevices()
    await this.stop()
  }

  private build(): FastifyInstance {
    const app = Fastify({ logger: false, bodyLimit: 1024, trustProxy: false })

    app.addHook('onRequest', async (req, reply) => {
      if (!isAllowedHost(req.headers.host)) return reply.code(421).send({ error: 'Unknown host' })
    })
    app.addHook('onSend', async (_req, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('Referrer-Policy', 'no-referrer')
      reply.header('X-Frame-Options', 'DENY')
    })

    app.register(fastifyWebsocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } })
    app.register(async (scoped) => {
      scoped.get('/api/health', async () => ({ ok: true, protocol: PROTOCOL_VERSION }))
      // Phones install this once to trust https:// on this computer. Public by design: a CA
      // certificate holds no secret.
      scoped.get('/tessel-ca.crt', async (_req, reply) => {
        if (!this.tls) return reply.code(404).send({ error: 'Secure connections are off' })
        return reply
          .type('application/x-x509-ca-cert')
          .header('Content-Disposition', 'attachment; filename="Tessel.crt"')
          .send(this.tls.ca)
      })
      scoped.post('/api/pair', (req, reply) => this.handlePair(req, reply))
      scoped.post('/api/pair/wait', (req, reply) => this.handlePairWait(req, reply))
      // Shortcut apps may send a form or text body with the POST; it's ignored.
      scoped.addContentTypeParser(
        ['application/x-www-form-urlencoded', 'text/plain'],
        { parseAs: 'string' },
        (_req, body, done) => done(null, body),
      )
      // Shortcut links: POST runs the tile behind the key; GET only explains, so a browser
      // opening or prefetching the link never runs anything.
      scoped.post<{ Params: { key: string } }>('/run/:key', (req, reply) =>
        this.handleRun(req.params.key, req.ip, reply),
      )
      scoped.get('/run/:key', async (_req, reply) =>
        reply
          .type('text/html; charset=utf-8')
          .send(
            '<!doctype html><meta name="viewport" content="width=device-width"><title>Tessel shortcut</title><body style="font:16px system-ui;padding:24px;max-width:32em">This is a Tessel shortcut link. It runs a tile when something sends it a POST request, such as the Shortcuts app with <b>Get Contents of URL</b> set to <b>POST</b>. Opening it in a browser does nothing.</body>',
          ),
      )
      scoped.get(
        '/ws',
        {
          websocket: true,
          preValidation: async (req, reply) => {
            if (!isSameOrigin(req.headers.origin, req.headers.host)) {
              return reply.code(403).send({ error: 'Bad origin' })
            }
          },
        },
        (socket, req) => this.handleSocket(socket, req.ip),
      )
    })

    const { phoneDir } = this.opts
    if (existsSync(join(phoneDir, 'index.html'))) {
      app.register(fastifyStatic, {
        root: phoneDir,
        // Hashed assets never change; index.html must be re-fetched so phones pick up new builds.
        setHeaders: (reply, path) =>
          reply.header(
            'Cache-Control',
            path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
          ),
      })
      app.setNotFoundHandler((req, reply) => {
        const path = req.url.split('?')[0] ?? ''
        const isPage = req.method === 'GET' && !path.startsWith('/api/') && !/\.\w+$/.test(path)
        if (isPage) return reply.sendFile('index.html')
        return reply.code(404).send({ error: 'Not found' })
      })
    } else {
      app.get('/', async (_req, reply) =>
        reply
          .type('text/plain')
          .send('Phone client not built. Run: pnpm --filter @tessel/phone build'),
      )
    }
    return app
  }

  private runHits = new Map<string, number[]>()

  private async handleRun(key: string, ip: string, reply: FastifyReply) {
    // At most 10 runs a second, and 60 a minute, per address.
    const now = Date.now()
    const hits = (this.runHits.get(ip) ?? []).filter((t) => now - t < 60_000)
    if (hits.filter((t) => now - t < 1000).length >= 10 || hits.length >= 60) {
      reply.header('Retry-After', '5')
      return reply.code(429).send({ ok: false, error: 'Too many runs. Wait a moment.' })
    }
    hits.push(now)
    this.runHits.set(ip, hits)
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key) || !this.opts.onRunKey)
      return reply.code(404).send({ ok: false, error: 'Unknown shortcut' })
    const result = await this.opts.onRunKey(key)
    if (!result) return reply.code(404).send({ ok: false, error: 'Unknown shortcut' })
    return reply.code(result.ok ? 200 : 409).send(result)
  }

  private async handlePair(req: FastifyRequest, reply: FastifyReply) {
    if (!isSameOrigin(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'Bad origin' })
    }
    const body = PairRequest.safeParse(req.body)
    if (!body.success)
      return reply.code(400).send({ error: 'Enter the 6-digit code from your computer.' })

    const result = this.opts.pairing.attempt(req.ip, body.data.code)
    if (!result.ok) {
      if (result.reason === 'rate-limited') {
        const seconds = Math.ceil(result.retryAfterMs / 1000)
        reply.header('Retry-After', String(seconds))
        return reply.code(429).send({ error: `Too many tries. Wait ${seconds} seconds.` })
      }
      this.opts.logger.warn(`Wrong pairing code from ${req.ip}`)
      return reply.code(401).send({ error: 'That code is not right. Check your computer.' })
    }
    const old = body.data.previousToken
      ? this.opts.devices.verify(body.data.previousToken)
      : undefined
    const request = this.opts.approvals.open(
      body.data.deviceName,
      req.ip,
      old ? { id: old.id, name: old.name } : undefined,
    )
    if (!request) {
      reply.header('Retry-After', '30')
      return reply
        .code(429)
        .send({ error: 'Other phones are waiting to be approved. Try again in a moment.' })
    }
    this.opts.logger.info(`"${body.data.deviceName}" (${req.ip}) is waiting for you to approve it`)
    return reply
      .code(202)
      .send({ requestId: request.id, secret: request.secret } satisfies PairPending)
  }

  /** Long-polls until the computer approves or refuses the phone. Only then is a token made. */
  private async handlePairWait(req: FastifyRequest, reply: FastifyReply) {
    if (!isSameOrigin(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'Bad origin' })
    }
    const body = PairWaitRequest.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Bad request' })
    const { requestId, secret } = body.data
    await this.opts.approvals.wait(requestId, secret, PAIR_WAIT_MS)
    const answer = this.opts.approvals.claim(requestId, secret)
    if (!answer) return reply.code(404).send({ error: 'That request is gone. Pair again.' })
    switch (answer.outcome.status) {
      case 'pending':
        return reply.code(200).send({ status: 'pending' })
      case 'denied':
        return reply.code(403).send({ error: 'Refused on your computer.' })
      case 'expired':
        return reply.code(410).send({ error: 'Nobody approved it in time. Pair again.' })
      case 'approved': {
        const { name, replaces } = answer.info
        const paired = await this.opts.devices.pair(name)
        if (replaces) await this.opts.devices.revoke(replaces.id)
        this.opts.logger.info(
          replaces ? `Paired "${name}", replacing "${replaces.name}"` : `Paired "${name}"`,
        )
        return paired satisfies PairResponse
      }
    }
  }

  private handleSocket(socket: WebSocket, ip: string) {
    const client: Client = { socket, ip, alive: true }
    this.clients.add(client)
    const send = (m: ServerMessage) => socket.send(JSON.stringify(m))
    const helloTimer = setTimeout(() => {
      if (!client.device) socket.close(CloseCode.unauthorized, 'No hello')
    }, HELLO_TIMEOUT_MS)

    let windowStart = Date.now()
    let count = 0

    socket.on('pong', () => (client.alive = true))
    socket.on('close', () => {
      clearTimeout(helloTimer)
      this.clients.delete(client)
      if (client.device) this.emitPhones()
    })
    socket.on('message', (raw, isBinary) => {
      const now = Date.now()
      if (now - windowStart >= 1000) {
        windowStart = now
        count = 0
      }
      if (++count > MAX_MESSAGES_PER_SECOND || isBinary) {
        socket.close(1008, 'Too many messages')
        return
      }

      const parsed = parseClientMessage(raw.toString())
      if (!parsed.ok) {
        send({ type: 'error', code: 'bad-message', message: parsed.error })
        return
      }
      const msg = parsed.message

      if (!client.device) {
        if (msg.type !== 'hello') {
          socket.close(CloseCode.unauthorized, 'Say hello first')
          return
        }
        if (msg.protocol !== PROTOCOL_VERSION) {
          send({
            type: 'error',
            code: 'protocol-mismatch',
            message: `Desktop speaks protocol ${PROTOCOL_VERSION}, phone sent ${msg.protocol}. Reload the page.`,
          })
          socket.close(CloseCode.protocolMismatch, 'Protocol mismatch')
          return
        }
        const device = this.opts.devices.verify(msg.token)
        if (!device) {
          send({ type: 'error', code: 'unauthorized', message: 'This phone is not paired.' })
          socket.close(CloseCode.unauthorized, 'Unknown token')
          return
        }
        clearTimeout(helloTimer)
        client.device = device
        void this.opts.devices.touch(device.id, msg.deviceName || undefined)
        send({ type: 'profile', profile: toPhoneProfile(this.profile) })
        this.opts.welcomeMessages?.().forEach(send)
        this.emitPhones()
        return
      }

      switch (msg.type) {
        case 'hello':
          return
        case 'ping':
          send({ type: 'pong', t: msg.t })
          return
        case 'press':
          if (!this.hasTile(msg.tileId)) return
          this.opts.onPress?.({ deviceId: client.device.id, tileId: msg.tileId, phase: msg.phase })
          return
        case 'slide':
          if (
            !this.profile.pages.some((p) =>
              p.tiles.some((t) => t.id === msg.tileId && t.kind === 'slider'),
            )
          )
            return
          this.opts.onSlide?.({ deviceId: client.device.id, tileId: msg.tileId, value: msg.value })
          return
        case 'editTile': {
          const { type: _, ...edit } = msg
          if (!this.hasTile(msg.tileId) || (msg.swapWith && !this.hasTile(msg.swapWith))) return
          this.opts.onEditTile?.(client.device.id, edit)
          return
        }
        case 'location':
          this.opts.onLocation?.(client.device.id, {
            lat: msg.lat,
            lon: msg.lon,
            ...(msg.accuracy !== undefined && { accuracy: msg.accuracy }),
          })
          return
        case 'pageChange':
          if (!this.profile.pages.some((p) => p.id === msg.pageId)) return
          this.opts.onPageChange?.(client.device.id, msg.pageId)
          return
      }
    })
  }

  private hasTile(tileId: string) {
    return this.profile.pages.some((p) => p.tiles.some((t) => t.id === tileId))
  }

  private dropRevokedClients() {
    const known = new Set(this.opts.devices.list().map((d) => d.id))
    for (const c of this.clients) {
      if (c.device && !known.has(c.device.id)) c.socket.close(CloseCode.revoked, 'Device removed')
    }
  }

  private checkHeartbeats() {
    for (const c of this.clients) {
      if (!c.alive) {
        c.socket.terminate()
        continue
      }
      c.alive = false
      c.socket.ping()
    }
  }

  private emitPhones() {
    this.opts.onPhonesChanged?.(this.phones())
  }

  // mDNS goodbye packets are best effort; never let them hold up shutdown.
  private async unadvertise() {
    const bonjour = this.bonjour
    if (!bonjour) return
    this.bonjour = undefined
    await Promise.race([
      new Promise<void>((resolve) => bonjour.unpublishAll(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ])
    try {
      bonjour.destroy()
    } catch (err) {
      this.opts.logger.warn(`mDNS shutdown: ${String(err)}`)
    }
  }

  private advertise(port: number) {
    this.bonjour = new Bonjour(undefined, (err: unknown) =>
      this.opts.logger.warn(`mDNS advertising failed: ${String(err)}`),
    )
    const names = mdnsNames(hostname())
    this.bonjour.publish({
      name: names.service,
      // Always a .local name: phones resolve it over multicast DNS, whatever the computer's own hostname is.
      host: names.host,
      type: 'tessel',
      protocol: 'tcp',
      port,
      txt: { protocol: String(PROTOCOL_VERSION) },
    })
  }
}

/**
 * Service and host names for Bonjour. Hostnames like `mac.tailnet.ts.net` or `DESKTOP-1` become
 * `mac.local` / `DESKTOP-1.local`, which phones can resolve with multicast DNS.
 */
export function mdnsNames(hostname: string): { service: string; host: string } {
  const short =
    hostname
      .split('.')[0]
      ?.replace(/[^A-Za-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'tessel'
  return { service: `Tessel on ${short}`, host: `${short}.local` }
}
