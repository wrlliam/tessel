import { defineBlock, definePlugin, defineTrigger, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'
import { ObsClient, type OpenSocket } from './client.ts'

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }
const onOff = z.enum(['toggle', 'start', 'stop'])

export function createObsPlugin(open: OpenSocket) {
  let settings = { host: '127.0.0.1', port: 4455, password: '' }
  const obs = new ObsClient(open, () => settings)
  const call = async <T = Record<string, unknown>>(
    type: string,
    data?: Record<string, unknown>,
  ) => {
    try {
      return await obs.request<T>(type, data)
    } catch (err) {
      throw new PluginError((err as Error).message)
    }
  }

  return definePlugin({
    onLoad(ctx) {
      settings = {
        host: String(ctx.settings['host'] || '127.0.0.1'),
        port: Number(ctx.settings['port'] || 4455),
        password: String(ctx.settings['password'] ?? ''),
      }
    },
    onSettings(s) {
      settings = {
        host: String(s['host'] || '127.0.0.1'),
        port: Number(s['port'] || 4455),
        password: String(s['password'] ?? ''),
      }
      obs.close()
    },
    onUnload: () => obs.close(),
    blocks: [
      defineBlock({
        id: 'scene',
        name: 'OBS: switch scene',
        description: 'Switches OBS to a scene by its name.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ scene: z.string().min(1, 'Type the scene name').max(200) }),
        fields: [{ key: 'scene', label: 'Scene', widget: 'text', placeholder: 'Camera' }],
        defaults: { scene: 'Scene' },
        run: async (_ctx, p) => {
          await call('SetCurrentProgramScene', { sceneName: p.scene })
        },
      }),
      defineBlock({
        id: 'output',
        name: 'OBS: record, stream or replay',
        description:
          "Starts, stops or toggles recording, streaming or the virtual camera, or saves the replay buffer. Goes out 'on' or 'off'.",
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
        ],
        paramsSchema: z.object({
          what: z.enum(['record', 'stream', 'virtualcam', 'replay']).default('record'),
          action: onOff.default('toggle'),
        }),
        fields: [
          {
            key: 'what',
            label: 'What',
            widget: 'select',
            options: [
              { value: 'record', label: 'Recording' },
              { value: 'stream', label: 'Streaming' },
              { value: 'virtualcam', label: 'Virtual camera' },
              { value: 'replay', label: 'Save replay' },
            ],
          },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'toggle', label: 'Toggle' },
              { value: 'start', label: 'Start' },
              { value: 'stop', label: 'Stop' },
            ],
            when: { key: 'what', is: ['record', 'stream', 'virtualcam'] },
          },
        ],
        defaults: { what: 'record', action: 'toggle' },
        run: async (ctx, p) => {
          if (p.what === 'replay') {
            await call('SaveReplayBuffer')
            return { next: 'on' }
          }
          const name = { record: 'Record', stream: 'Stream', virtualcam: 'VirtualCam' }[p.what]
          const verb = { toggle: 'Toggle', start: 'Start', stop: 'Stop' }[p.action]
          const res = await call<{ outputActive?: boolean }>(`${verb}${name}`)
          const on = p.action === 'toggle' ? Boolean(res.outputActive) : p.action === 'start'
          ctx.setTileState(
            p.what === 'stream' ? 'live' : p.what === 'record' ? 'recording' : 'camera',
            on,
          )
          return { next: on ? 'on' : 'off' }
        },
      }),
      defineBlock({
        id: 'mute',
        name: 'OBS: mute a source',
        description:
          "Mutes, unmutes or toggles an audio source, e.g. Mic/Aux. Goes out 'muted' or 'live'.",
        inputs: [flowIn],
        outputs: [
          { id: 'muted', kind: 'flow' },
          { id: 'live', kind: 'flow' },
        ],
        paramsSchema: z.object({
          input: z.string().min(1, 'Type the source name').max(200),
          action: z.enum(['toggle', 'mute', 'unmute']).default('toggle'),
        }),
        fields: [
          { key: 'input', label: 'Source', widget: 'text', placeholder: 'Mic/Aux' },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'toggle', label: 'Toggle' },
              { value: 'mute', label: 'Mute' },
              { value: 'unmute', label: 'Unmute' },
            ],
          },
        ],
        defaults: { input: 'Mic/Aux', action: 'toggle' },
        run: async (ctx, p) => {
          let muted: boolean
          if (p.action === 'toggle') {
            const res = await call<{ inputMuted: boolean }>('ToggleInputMute', {
              inputName: p.input,
            })
            muted = res.inputMuted
          } else {
            muted = p.action === 'mute'
            await call('SetInputMute', { inputName: p.input, inputMuted: muted })
          }
          ctx.setTileState('muted', muted)
          return { next: muted ? 'muted' : 'live' }
        },
      }),
    ],
    triggers: [
      defineTrigger({
        id: 'watch',
        name: 'OBS: when it changes',
        description:
          'Keeps OBS state on the tile, so it lights up while live: {{state.live}}, {{state.recording}}, {{state.scene}} and {{state.muted}} for the source you name.',
        outputs: [{ id: 'value', kind: 'value', type: 'any' }],
        paramsSchema: z.object({ input: z.string().max(200).default('') }),
        fields: [
          {
            key: 'input',
            label: 'Watch mute of source',
            widget: 'text',
            placeholder: 'Mic/Aux (optional)',
          },
        ],
        defaults: { input: '' },
        subscribe: (ctx, sub) => {
          let stopped = false
          const off = obs.onEvent((type, d) => {
            if (type === 'CurrentProgramSceneChanged') {
              sub.setTileState('scene', String(d['sceneName']))
              sub.emit({ value: d['sceneName'] })
            } else if (type === 'StreamStateChanged') {
              sub.setTileState('live', Boolean(d['outputActive']))
              sub.emit({ value: d['outputActive'] })
            } else if (type === 'RecordStateChanged') {
              sub.setTileState('recording', Boolean(d['outputActive']))
              sub.emit({ value: d['outputActive'] })
            } else if (
              type === 'InputMuteStateChanged' &&
              sub.params.input &&
              d['inputName'] === sub.params.input
            ) {
              sub.setTileState('muted', Boolean(d['inputMuted']))
              sub.emit({ value: d['inputMuted'] })
            }
          })
          // Read the current state once, then follow OBS's events; retry while OBS is closed.
          const load = async () => {
            if (stopped) return
            try {
              const scene = await obs.request<{ currentProgramSceneName: string }>(
                'GetCurrentProgramScene',
              )
              sub.setTileState('scene', scene.currentProgramSceneName)
              const stream = await obs.request<{ outputActive: boolean }>('GetStreamStatus')
              sub.setTileState('live', stream.outputActive)
              const record = await obs.request<{ outputActive: boolean }>('GetRecordStatus')
              sub.setTileState('recording', record.outputActive)
              if (sub.params.input) {
                const m = await obs.request<{ inputMuted: boolean }>('GetInputMute', {
                  inputName: sub.params.input,
                })
                sub.setTileState('muted', m.inputMuted)
              }
            } catch (err) {
              ctx.log.warn(`OBS: ${(err as Error).message}`)
              retry = setTimeout(() => void load(), 15_000)
            }
          }
          let retry: ReturnType<typeof setTimeout> | undefined
          void load()
          return () => {
            stopped = true
            clearTimeout(retry)
            off()
          }
        },
      }),
    ],
  })
}
