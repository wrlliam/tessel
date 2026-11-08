import { createOllamaPlugin } from './plugin.ts'

export default createOllamaPlugin((url, init) => fetch(url, init))
