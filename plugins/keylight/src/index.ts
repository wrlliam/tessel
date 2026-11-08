import { createKeyLightPlugin } from './plugin.ts'

export default createKeyLightPlugin((url, init) => fetch(url, init))
