import { CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { normaliseAddress, urlFromService, type FoundComputer } from './server.ts'

interface Discovery {
  start(): Promise<void>
  stop(): Promise<void>
  addListener(
    event: 'found',
    cb: (s: { name: string; host: string; port: number; addresses: string[] }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'lost', cb: (s: { name: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'error', cb: (e: { message: string }) => void): Promise<PluginListenerHandle>
}

/** Bonjour browsing for _tessel._tcp, implemented in the app (ios/App/App/TesselDiscoveryPlugin.swift). */
const Discovery = registerPlugin<Discovery>('TesselDiscovery')
const SERVER_KEY = 'server'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = (text: string) => ($('status').textContent = text)
const found = new Map<string, FoundComputer>()

/** Checks the computer answers before leaving this screen, so mistakes are explained here. */
async function reachable(url: string): Promise<boolean> {
  try {
    const res = await CapacitorHttp.get({
      url: `${url}api/health`,
      connectTimeout: 4000,
      readTimeout: 4000,
    })
    return res.status === 200 && (res.data as { ok?: boolean })?.ok === true
  } catch {
    return false
  }
}

async function connect(url: string) {
  status('')
  if (!(await reachable(url))) {
    status(
      `Can't reach ${url}. Check Tessel is open on the computer with "Allow phones" on, and that this phone is on the same Wi-Fi.`,
    )
    return
  }
  await Preferences.set({ key: SERVER_KEY, value: url })
  await Discovery.stop().catch(() => {})
  window.location.href = url
}

function render() {
  const list = $('found')
  list.replaceChildren(
    ...[...found.values()].map((c) => {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = c.name
      const addr = document.createElement('span')
      addr.className = 'addr'
      addr.textContent = c.url.replace(/^http:\/\/|\/$/g, '')
      button.append(addr)
      button.addEventListener('click', () => void connect(c.url))
      li.append(button)
      return li
    }),
  )
  $('searching').textContent = found.size ? '' : 'Looking for Tessel…'
}

async function start() {
  const params = new URLSearchParams(location.search)
  const saved = (await Preferences.get({ key: SERVER_KEY })).value
  if (saved) ($('address') as HTMLInputElement).value = saved.replace(/^http:\/\/|\/$/g, '')
  // Go straight back to the last computer unless the user asked to pick another.
  if (saved && !params.has('pick') && (await reachable(saved))) {
    window.location.href = saved
    return
  }

  $<HTMLFormElement>('manual').addEventListener('submit', (e) => {
    e.preventDefault()
    const url = normaliseAddress(($('address') as HTMLInputElement).value)
    if (url) void connect(url)
    else status('Type the address shown under the QR code, like 192.168.1.20:4747.')
  })

  await Discovery.addListener('found', (s) => {
    const computer = urlFromService(s)
    if (computer) {
      found.set(s.name, computer)
      render()
    }
  })
  await Discovery.addListener('lost', (s) => {
    found.delete(s.name)
    render()
  })
  await Discovery.addListener('error', (e) => status(e.message))
  await Discovery.start().catch(() =>
    status('Searching the network failed. You can still type the address.'),
  )
}

start().catch((err: unknown) => {
  status(
    `Something went wrong starting up: ${err instanceof Error ? err.message : String(err)}. You can still type the address.`,
  )
})
