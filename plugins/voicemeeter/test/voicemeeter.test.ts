import { createHarness } from '@tessel/plugin-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scriptValue, toDb, VoicemeeterError } from '../src/api.ts'
import { MockVoicemeeter } from '../src/mock.ts'
import { dirFromRegOutput } from '../src/native.ts'
import { createVoicemeeterPlugin } from '../src/plugin.ts'

function setup(kind: 'basic' | 'banana' | 'potato' = 'banana', os: 'win32' | 'darwin' = 'win32') {
  const vm = new MockVoicemeeter(kind)
  const connect = vi.fn(async () => vm)
  const h = createHarness(createVoicemeeterPlugin(connect), { os })
  return { vm, connect, h }
}

afterEach(() => vi.useRealTimers())

describe('blocks', () => {
  it('sets strip and bus gain, counting from 1', async () => {
    const { vm, h } = setup()
    await h.run('setGain', { target: 'strip', index: 1, gain: -6 })
    await h.run('setGain', { target: 'bus', index: '3', gain: '2.5' })
    expect(vm.params.get('Strip[0].Gain')).toBe(-6)
    expect(vm.params.get('Bus[2].Gain')).toBe(2.5)
  })

  it('refuses channels the Voicemeeter type does not have', async () => {
    const { h } = setup('basic')
    await expect(h.run('setGain', { target: 'strip', index: 4, gain: 0 })).rejects.toThrow(
      'Voicemeeter basic has 3 inputs (numbered 1 to 3)',
    )
  })

  it('rejects out-of-range gain', async () => {
    const { h } = setup()
    await expect(h.run('setGain', { target: 'strip', index: 1, gain: 20 })).rejects.toThrow()
  })

  it('mutes, unmutes and toggles, keeping tile state', async () => {
    const { vm, h } = setup()
    expect(await h.run('mute', { target: 'strip', index: 2, action: 'toggle' })).toEqual({
      values: { muted: true },
    })
    expect(vm.params.get('Strip[1].Mute')).toBe(1)
    expect(h.tileState.get('muted')).toBe(true)
    await h.run('mute', { target: 'strip', index: 2, action: 'toggle' })
    expect(vm.params.get('Strip[1].Mute')).toBe(0)
    await h.run('mute', { target: 'bus', index: 1, action: 'on' })
    expect(vm.params.get('Bus[0].Mute')).toBe(1)
  })

  it('solos inputs', async () => {
    const { vm, h } = setup()
    await h.run('solo', { index: 1, action: 'on' })
    expect(vm.params.get('Strip[0].Solo')).toBe(1)
  })

  it('routes inputs to outputs that exist on this type', async () => {
    const { vm, h } = setup('banana')
    await h.run('routing', { index: 1, output: 'B2', action: 'toggle' })
    expect(vm.params.get('Strip[0].B2')).toBe(1)
    await expect(h.run('routing', { index: 1, output: 'A5', action: 'on' })).rejects.toThrow(
      'Voicemeeter banana has no A5 output',
    )
    const potato = setup('potato')
    await potato.h.run('routing', { index: 8, output: 'A5', action: 'on' })
    expect(potato.vm.params.get('Strip[7].A5')).toBe(1)
  })

  it('presses macro buttons', async () => {
    const { vm, h } = setup()
    await h.run('macroButton', { button: 3, action: 'press' })
    await h.run('macroButton', { button: 4, action: 'on' })
    expect(vm.macro.get(2)).toEqual([1, 0])
    expect(vm.macro.get(3)).toEqual([1])
  })

  it('loads presets', async () => {
    const { vm, h } = setup()
    await h.run('loadPreset', { path: 'C:\\Users\\me\\stream.xml' })
    expect(vm.params.get('Command.Load')).toBe('C:\\Users\\me\\stream.xml')
    await expect(h.run('loadPreset', { path: 'C:\\x.txt' })).rejects.toThrow(/\.xml/)
  })

  it('reads levels in dB', async () => {
    const { vm, h } = setup()
    vm.levels.set('3:0', 0.5)
    expect(await h.run('getLevel', { kind: 3, channel: 0 })).toEqual({
      values: { value: 0.5, db: -6 },
    })
  })

  it('gets and sets raw parameters, numbers and text', async () => {
    const { vm, h } = setup()
    await h.run('setParameter', { param: 'Strip[0].Gain', value: '-3' })
    await h.run('setParameter', { param: 'Strip[0].Label', value: 'Mic' })
    expect(vm.scripts).toEqual(['Strip[0].Gain=-3;', 'Strip[0].Label="Mic";'])
    expect(await h.run('getParameter', { param: 'Strip[0].Gain' })).toEqual({
      values: { value: -3 },
    })
  })

  it('refuses parameter names or values that could inject commands', async () => {
    const { h } = setup()
    await expect(
      h.run('setParameter', { param: 'Strip[0].Gain=0;Strip[1].Mute', value: 1 }),
    ).rejects.toThrow()
    await expect(
      h.run('setParameter', { param: 'Strip[0].Label', value: 'a";Strip[1].Mute=1;"' }),
    ).rejects.toThrow(/quotes/)
  })

  it('says Voicemeeter is Windows-only elsewhere, without connecting', async () => {
    const { h, connect } = setup('banana', 'darwin')
    await h.load()
    await expect(h.run('setGain', { target: 'strip', index: 1, gain: 0 })).rejects.toThrow(
      'Voicemeeter is Windows-only.',
    )
    expect(connect).not.toHaveBeenCalled()
  })

  it('reports a missing Voicemeeter plainly and retries next time', async () => {
    const vm = new MockVoicemeeter()
    const connect = vi
      .fn<() => Promise<MockVoicemeeter>>()
      .mockRejectedValueOnce(new VoicemeeterError("Voicemeeter isn't installed."))
      .mockResolvedValue(vm)
    const h = createHarness(createVoicemeeterPlugin(connect))
    await expect(h.run('solo', { index: 1, action: 'on' })).rejects.toThrow(
      "Voicemeeter isn't installed.",
    )
    await h.run('solo', { index: 1, action: 'on' })
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('logs out on unload', async () => {
    const { vm, h } = setup()
    await h.load()
    await h.run('solo', { index: 1, action: 'on' })
    await h.unload()
    expect(vm.loggedOut).toBe(true)
  })
})

describe('On parameter change', () => {
  it('sends the current value, then changes found by polling the dirty flag', async () => {
    vi.useFakeTimers()
    const { vm, h } = setup()
    vm.params.set('Strip[0].Mute', 0)
    const sub = h.subscribe('parameterChange', { param: 'Strip[0].Mute', stateKey: 'muted' })
    await vi.advanceTimersByTimeAsync(10)
    expect(sub.events).toEqual([{ value: 0 }])
    expect(h.tileState.get('muted')).toBe(false)

    vm.externalChange('Strip[0].Mute', 1)
    await vi.advanceTimersByTimeAsync(60)
    expect(sub.events.at(-1)).toEqual({ value: 1 })
    expect(h.tileState.get('muted')).toBe(true)

    // Dirty but unchanged: no event.
    vm.externalChange('Strip[0].Mute', 1)
    await vi.advanceTimersByTimeAsync(60)
    expect(sub.events).toHaveLength(2)

    sub.stop()
    vm.externalChange('Strip[0].Mute', 0)
    await vi.advanceTimersByTimeAsync(60)
    expect(sub.events).toHaveLength(2)
  })
})

describe('helpers', () => {
  it('finds the install folder from the uninstall entry', () => {
    const output =
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\r\n    UninstallString    REG_SZ    "C:\\Program Files (x86)\\VB\\Voicemeeter\\voicemeeterprosetup.exe"\r\n'
    expect(dirFromRegOutput(output)).toBe('C:\\Program Files (x86)\\VB\\Voicemeeter')
    expect(dirFromRegOutput('')).toBeUndefined()
  })

  it('formats script values and dB', () => {
    expect(scriptValue(-6)).toBe('-6')
    expect(scriptValue(' 1.5 ')).toBe('1.5')
    expect(scriptValue('Mic')).toBe('"Mic"')
    expect(toDb(1)).toBe(0)
    expect(toDb(0)).toBe(-200)
  })
})
