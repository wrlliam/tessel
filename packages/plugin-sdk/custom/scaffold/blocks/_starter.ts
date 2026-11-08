// Files starting with _ are skipped. Tessel copies this one when you press New block.
import { block } from '../tessel/index.ts'

export default block({
  name: 'My block',
  description: 'What it does, in one sentence.',
  params: {
    message: { type: 'text', label: 'Message', default: 'Hello' },
  },
  values: { result: 'string' },
  run({ params }) {
    return { values: { result: params.message.toUpperCase() } }
  },
})
