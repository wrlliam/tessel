import { createSlackPlugin } from './plugin.ts'

export default createSlackPlugin((url, init) => fetch(url, init))
