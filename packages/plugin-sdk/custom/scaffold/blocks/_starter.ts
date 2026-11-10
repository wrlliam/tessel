// Files starting with _ are skipped. Tessel copies this one when you press New block.
import { block } from '../tessel/index.ts'

export default block({
  name: 'My block',
  description: 'What it does, in one sentence.',
  params: {
    message: { type: 'text', label: 'Message', default: 'Hello' },
  },
  values: { result: 'string' },
  // std has helpers (std.date, std.text, std.math, std.http) and every Tessel block as a
  // function: type std.blocks. to see them, e.g. await std.blocks.systemStats() or
  // await std.blocks.popup({ title: 'Hi' }). Your other blocks here are under std.my.
  async run({ params, std }) {
    const { hour } = await std.blocks.getTime()
    return { values: { result: `${params.message.toUpperCase()} at ${hour ?? '?'}:00` } }
  },
})
