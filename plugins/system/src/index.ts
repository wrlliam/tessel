import { cpus, freemem, totalmem, uptime } from 'node:os'
import { createSystemPlugin, type Sampler } from './plugin.ts'

const ticks = () =>
  cpus().reduce(
    (t, c) => ({
      busy: t.busy + c.times.user + c.times.nice + c.times.sys + c.times.irq,
      all: t.all + c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle,
    }),
    { busy: 0, all: 0 },
  )

let last = ticks()
const sampler: Sampler = {
  cpu() {
    const now = ticks()
    const share = (now.busy - last.busy) / Math.max(1, now.all - last.all)
    last = now
    return share * 100
  },
  memory: () => ({
    usedPercent: (1 - freemem() / totalmem()) * 100,
    freeGb: freemem() / 1024 ** 3,
  }),
  uptimeMinutes: () => uptime() / 60,
}

export default createSystemPlugin(sampler)
