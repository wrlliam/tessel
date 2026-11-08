import { connectNative } from './native.ts'
import { createVoicemeeterPlugin } from './plugin.ts'

export default createVoicemeeterPlugin(connectNative)
