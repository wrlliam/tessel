import { createHuePlugin } from './plugin.ts'

export default createHuePlugin((url, init) => fetch(url, init))
