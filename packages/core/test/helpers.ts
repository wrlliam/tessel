import { vi } from 'vitest'
import {
  createRegistry,
  Engine,
  MemoryVariables,
  type EngineEvent,
  type EngineOptions,
  type Graph,
  type Platform,
} from '../src/index.ts'

export function mockPlatform(os: Platform['os'] = 'darwin') {
  return {
    os,
    openApp: vi.fn(async (_app: string) => {}),
    openUrl: vi.fn(async (_url: string) => {}),
    openFile: vi.fn(async (_path: string) => {}),
    typeText: vi.fn(async (_text: string) => {}),
    pressCombo: vi.fn(async () => {}),
    mediaKey: vi.fn(async () => {}),
    mouse: vi.fn(async () => {}),
    setDarkMode: vi.fn(async (_on: boolean | 'toggle') => {}),
    setMuted: vi.fn(async (_on: boolean | 'toggle') => {}),
    setVolume: vi.fn(async (_level: number) => {}),
    setBrightness: vi.fn(async (_level: number) => {}),
    lockScreen: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    setClipboard: vi.fn(async (_text: string) => {}),
    notify: vi.fn(async (_title: string, _body: string) => {}),
    runShell: vi.fn(async () => ({ code: 0, stdout: 'hello\n', stderr: '' })),
    http: vi.fn(async () => ({ status: 200, body: '{"ok":true}' })),
  } satisfies Platform
}

export function setup(overrides: Partial<EngineOptions> = {}) {
  const platform = mockPlatform()
  const events: EngineEvent[] = []
  const globals = new MemoryVariables()
  const engine = new Engine({
    registry: createRegistry(),
    platform,
    globals,
    onEvent: (e) => events.push(e),
    ...overrides,
  })
  return { engine, platform, events, globals }
}

let edgeCount = 0
/** Wire helper: 'a.out' -> 'b.in'. */
export function wire(from: string, to: string) {
  const [fromNode = '', fromPort = ''] = from.split('.')
  const [toNode = '', toPort = ''] = to.split('.')
  return {
    id: `e${++edgeCount}`,
    from: { nodeId: fromNode, port: fromPort },
    to: { nodeId: toNode, port: toPort },
  }
}

export const node = (id: string, type: string, params: Record<string, unknown> = {}) => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
})

export const tile = (graph: Graph, concurrency?: 'ignore' | 'restart' | 'queue') => ({
  id: 'tile',
  graph,
  ...(concurrency && { concurrency }),
})

export const press = { type: 'press' as const }
