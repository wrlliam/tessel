import { defineBlock, definePlugin, defineTrigger } from '@tessel/plugin-sdk'
import { z } from 'zod'

export interface Sampler {
  /** CPU busy share since the last call, 0 to 100. */
  cpu(): number
  memory(): { usedPercent: number; freeGb: number }
  uptimeMinutes(): number
}

const round = (n: number) => Math.round(n * 10) / 10

export function createSystemPlugin(sampler: Sampler) {
  let checkSeconds = 5
  return definePlugin({
    onLoad: (ctx) => void (checkSeconds = Number(ctx.settings['checkSeconds'] ?? 5)),
    onSettings: (s) => void (checkSeconds = Number(s['checkSeconds'] ?? 5)),
    blocks: [
      defineBlock({
        id: 'info',
        name: 'System info',
        description: 'CPU and memory use right now.',
        inputs: [],
        outputs: [
          { id: 'cpu', kind: 'value', type: 'number', label: 'CPU %' },
          { id: 'memory', kind: 'value', type: 'number', label: 'memory used %' },
          { id: 'freeGb', kind: 'value', type: 'number', label: 'free memory (GB)' },
          { id: 'uptime', kind: 'value', type: 'number', label: 'uptime (minutes)' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: () => {
          const mem = sampler.memory()
          return {
            values: {
              cpu: round(sampler.cpu()),
              memory: round(mem.usedPercent),
              freeGb: round(mem.freeGb),
              uptime: Math.round(sampler.uptimeMinutes()),
            },
          }
        },
      }),
    ],
    triggers: [
      defineTrigger({
        id: 'highCpu',
        name: 'On high CPU',
        description:
          'Starts when CPU use goes above a level, then again only after it has dropped back below.',
        outputs: [{ id: 'cpu', kind: 'value', type: 'number', label: 'CPU %' }],
        paramsSchema: z.object({ threshold: z.coerce.number().min(1).max(100) }),
        fields: [{ key: 'threshold', label: 'Above (%)', widget: 'number', placeholder: '80' }],
        defaults: { threshold: 80 },
        subscribe: (_ctx, sub) => {
          let above = false
          sampler.cpu()
          const timer = setInterval(() => {
            const cpu = sampler.cpu()
            if (!above && cpu > sub.params.threshold) sub.emit({ cpu: round(cpu) })
            above = cpu > sub.params.threshold
          }, checkSeconds * 1000)
          return () => clearInterval(timer)
        },
      }),
    ],
  })
}
