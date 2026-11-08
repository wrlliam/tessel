// Toggles anything in Home Assistant and reports whether it's now on.
// Set the address and token in Plugins › My blocks › Settings first.
import { block } from '../tessel/index.ts'

export default block({
  name: 'Home Assistant: toggle and check',
  description: "Toggles an entity, then goes out 'on' or 'off' and sets {{state.on}} on the tile.",
  params: {
    entity: { type: 'text', label: 'Entity', default: 'light.desk', placeholder: 'light.desk' },
  },
  outputs: ['on', 'off'],
  values: { state: 'string' },
  async run({ params, ctx, std }) {
    const ha = std.homeAssistant({
      url: String(ctx.settings['haUrl'] ?? ''),
      token: String(ctx.settings['haToken'] ?? ''),
      signal: ctx.signal,
    })
    await ha.toggle(params.entity)
    await std.sleep(300, ctx.signal)
    const { state } = await ha.state(params.entity)
    ctx.setTileState('on', state === 'on')
    return { next: state === 'on' ? 'on' : 'off', values: { state } }
  },
})
