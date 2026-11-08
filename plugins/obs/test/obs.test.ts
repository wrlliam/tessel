import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { authString, type ObsSocket } from '../src/client.ts'
import { createObsPlugin } from '../src/plugin.ts'

/** Stands in for OBS: says hello, checks the password, answers requests, sends events. */
function fakeObs(password = 'secret') {
  const requests: Array<[string, Record<string, unknown>]> = []
  const state = { scene: 'Camera', recording: false, muted: false }
  let socket: (ObsSocket & { emit(type: string, data: object): void }) | undefined
  const open = () => {
    const s = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      close: vi.fn(() => s.onclose?.()),
      send(raw: string) {
        const { op, d } = JSON.parse(raw) as { op: number; d: Record<string, unknown> }
        const reply = (o: number, data: object) =>
          queueMicrotask(() => s.onmessage?.({ data: JSON.stringify({ op: o, d: data }) }))
        if (op === 1) {
          if (d['authentication'] !== authString(password, 'salt', 'chal')) return s.close()
          return reply(2, { negotiatedRpcVersion: 1 })
        }
        if (op === 6) {
          const type = String(d['requestType'])
          const data = (d['requestData'] ?? {}) as Record<string, unknown>
          requests.push([type, data])
          let responseData: object = {}
          if (type === 'ToggleRecord')
            responseData = { outputActive: (state.recording = !state.recording) }
          if (type === 'ToggleInputMute')
            responseData = { inputMuted: (state.muted = !state.muted) }
          if (type === 'GetCurrentProgramScene')
            responseData = { currentProgramSceneName: state.scene }
          if (type === 'GetStreamStatus' || type === 'GetRecordStatus')
            responseData = { outputActive: false }
          const ok = type !== 'SetCurrentProgramScene' || data['sceneName'] !== 'Nope'
          reply(7, {
            requestId: d['requestId'],
            requestStatus: ok
              ? { result: true, code: 100 }
              : { result: false, code: 600, comment: 'No source was found' },
            responseData,
          })
        }
      },
      emit(type: string, data: object) {
        s.onmessage?.({ data: JSON.stringify({ op: 5, d: { eventType: type, eventData: data } }) })
      },
    } as ObsSocket & { emit(type: string, data: object): void }
    socket = s
    queueMicrotask(() =>
      s.onmessage?.({
        data: JSON.stringify({
          op: 0,
          d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'chal' } },
        }),
      }),
    )
    return s
  }
  return { open, requests, emit: (t: string, d: object) => socket?.emit(t, d) }
}

const settings = { host: '127.0.0.1', port: 4455, password: 'secret' }

describe('OBS plugin', () => {
  it('logs in with the password and switches scenes', async () => {
    const obs = fakeObs()
    const h = createHarness(createObsPlugin(obs.open), { settings })
    await h.load()
    await h.run('scene', { scene: 'Screen' })
    expect(obs.requests[0]).toEqual(['SetCurrentProgramScene', { sceneName: 'Screen' }])
    await expect(h.run('scene', { scene: 'Nope' })).rejects.toThrow(/No source was found/)
  })

  it('toggles recording and a source mute, going out the matching way', async () => {
    const obs = fakeObs()
    const h = createHarness(createObsPlugin(obs.open), { settings })
    await h.load()
    expect(await h.run('output', { what: 'record', action: 'toggle' })).toEqual({ next: 'on' })
    expect(h.tileState.get('recording')).toBe(true)
    expect(await h.run('mute', { input: 'Mic/Aux', action: 'toggle' })).toEqual({ next: 'muted' })
  })

  it('says when the password is wrong or missing', async () => {
    const wrong = createHarness(createObsPlugin(fakeObs('other').open), { settings })
    await wrong.load()
    await expect(wrong.run('scene', { scene: 'A' })).rejects.toThrow(/password/)
    const none = createHarness(createObsPlugin(fakeObs().open), {
      settings: { ...settings, password: '' },
    })
    await none.load()
    await expect(none.run('scene', { scene: 'A' })).rejects.toThrow(/wants a password/)
  })

  it('keeps live state on the tile from OBS events', async () => {
    const obs = fakeObs()
    const h = createHarness(createObsPlugin(obs.open), { settings })
    await h.load()
    const sub = h.subscribe('watch', { input: 'Mic/Aux' })
    await vi.waitFor(() => expect(h.tileState.get('scene')).toBe('Camera'))
    obs.emit('StreamStateChanged', { outputActive: true })
    expect(h.tileState.get('live')).toBe(true)
    expect(sub.events).toEqual([{ value: true }])
    sub.stop()
  })
})
