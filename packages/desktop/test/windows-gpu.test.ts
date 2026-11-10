import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { mergeGpu } from '../src/main/platform/stats.ts'
import {
  parseReaderLine,
  readerScript,
  windowsGpuReader,
} from '../src/main/platform/windows-gpu.ts'

function fakeSpawn() {
  const children: Array<EventEmitter & { stdout: PassThrough; kill: () => void }> = []
  const start = (() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: () => child.emit('exit', 0),
    })
    children.push(child)
    return child
  }) as never
  return { start, children }
}

describe('Windows graphics card reader', () => {
  it('reads use, dedicated memory and temperature from a line', () => {
    expect(parseReaderLine('{"gpu":37.5,"memBytes":2147483648,"temp":61.3}')).toEqual({
      gpu: 37.5,
      gpuMemoryUsedGb: 2,
      gpuTemp: 61.3,
    })
    // Busy multi-engine cards can add up past 100.
    expect(parseReaderLine('{"gpu":130,"memBytes":null,"temp":null}')).toEqual({ gpu: 100 })
    expect(parseReaderLine('{"gpu":null,"memBytes":null,"temp":null}')).toBeUndefined()
    expect(parseReaderLine('Add-Type : something went wrong')).toBeUndefined()
  })

  it('fills in the temperature nvidia-smi left out, keeping its own numbers', () => {
    expect(mergeGpu({ gpu: 80, gpuMemory: 50 }, { gpu: 75, gpuTemp: 66 })).toEqual({
      gpu: 80,
      gpuMemory: 50,
      gpuTemp: 66,
    })
    expect(mergeGpu(undefined, { gpuTemp: 66 })).toEqual({ gpuTemp: 66 })
    expect(mergeGpu({ gpu: 1 }, undefined)).toEqual({ gpu: 1 })
  })

  it('builds a script that stops with Tessel and closes its here-string', () => {
    const script = readerScript(4242)
    expect(script).toContain('$parent = 4242')
    // PowerShell needs the here-string markers alone at the start of a line.
    expect(script.split('\n')).toContain("Add-Type -TypeDefinition @'")
    expect(script.split('\n')).toContain("'@")
    expect(script).toContain('[TesselGpu]::MaxTemperature()')
  })

  it('starts once, keeps the latest line, and restarts a crashed reader at most three times', async () => {
    const { start, children } = fakeSpawn()
    const read = windowsGpuReader(start)
    const pending = read()
    children[0]!.stdout.write('{"gpu":12,"memBytes":0,"temp":55}\n')
    expect(await pending).toEqual({ gpu: 12, gpuTemp: 55 })
    children[0]!.stdout.write('{"gpu":20,"memBytes":0,"temp":57}\n')
    await new Promise((r) => setTimeout(r, 0))
    expect(await read()).toEqual({ gpu: 20, gpuTemp: 57 })
    expect(children).toHaveLength(1)

    // The reader crashes; each read starts a new one, which crashes too, up to three in all.
    children.at(-1)!.emit('exit', 1)
    for (let i = 0; i < 5; i++) {
      const before = children.length
      const next = read()
      if (children.length > before) children.at(-1)!.emit('exit', 1)
      await next
    }
    expect(children).toHaveLength(3)
  })
})
