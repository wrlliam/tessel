import { createObsPlugin } from './plugin.ts'

export default createObsPlugin((url) => new WebSocket(url) as never)
