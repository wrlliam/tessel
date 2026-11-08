import { createGooglePlugin } from './plugin.ts'

export default createGooglePlugin((url, init) => fetch(url, init))
