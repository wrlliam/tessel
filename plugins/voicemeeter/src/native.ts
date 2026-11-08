import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { TYPE_BY_NUMBER, VoicemeeterError, type VoicemeeterApi } from './api.ts'

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VB:Voicemeeter {17359A74-1236-5467}',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VB:Voicemeeter {17359A74-1236-5467}',
]
const DEFAULT_DIR = 'C:\\Program Files (x86)\\VB\\Voicemeeter'

const query = (key: string) =>
  new Promise<string>((resolve) => {
    execFile(
      'reg.exe',
      ['query', key, '/v', 'UninstallString'],
      { windowsHide: true },
      (err, stdout) => resolve(err ? '' : stdout),
    )
  })

/** Reads `UninstallString    REG_SZ    C:\...\voicemeeterprosetup.exe` and returns its folder. */
export function dirFromRegOutput(output: string): string | undefined {
  const match = /UninstallString\s+REG_\w+\s+(.+)/.exec(output)
  const path = match?.[1]?.trim().replace(/^"|"$/g, '')
  return path ? win32.dirname(path) : undefined
}

/** Finds the folder holding VoicemeeterRemote64.dll via the installer's uninstall entry. */
export async function findInstallDir(): Promise<string> {
  for (const key of UNINSTALL_KEYS) {
    const dir = dirFromRegOutput(await query(key))
    if (dir && existsSync(join(dir, 'VoicemeeterRemote64.dll'))) return dir
  }
  if (existsSync(join(DEFAULT_DIR, 'VoicemeeterRemote64.dll'))) return DEFAULT_DIR
  throw new VoicemeeterError(
    "Voicemeeter isn't installed. Get it from vb-audio.com, then restart the plugin.",
  )
}

/** Loads the Remote API DLL with koffi and logs in. */
export async function connectNative(): Promise<VoicemeeterApi> {
  const dir = await findInstallDir()
  const { default: koffi } = await import('koffi')
  const lib = koffi.load(join(dir, 'VoicemeeterRemote64.dll'))
  const fn = (proto: string) => lib.func(`long __stdcall ${proto}`)
  const login = fn('VBVMR_Login()')
  const logout = fn('VBVMR_Logout()')
  const getType = fn('VBVMR_GetVoicemeeterType(_Out_ long *pType)')
  const isDirty = fn('VBVMR_IsParametersDirty()')
  const getFloat = fn('VBVMR_GetParameterFloat(const char *name, _Out_ float *value)')
  const getString = fn('VBVMR_GetParameterStringA(const char *name, _Out_ char *value)')
  const setFloat = fn('VBVMR_SetParameterFloat(const char *name, float value)')
  const setString = fn('VBVMR_SetParameterStringA(const char *name, const char *value)')
  const setParameters = fn('VBVMR_SetParameters(const char *script)')
  const getLevel = fn('VBVMR_GetLevel(long type, long channel, _Out_ float *value)')
  const macroSet = fn('VBVMR_MacroButton_SetStatus(long button, float value, long bitmode)')

  const loginResult = login() as number
  if (loginResult < 0)
    throw new VoicemeeterError(`Couldn't connect to Voicemeeter (code ${loginResult})`)

  const check = (code: number, what: string) => {
    if (code === -2 || code === -1)
      throw new VoicemeeterError('Voicemeeter is not running. Start it and try again.')
    if (code < 0) throw new VoicemeeterError(`Voicemeeter refused ${what} (code ${code})`)
  }

  return {
    type() {
      const out = [0]
      check(getType(out) as number, 'the version check')
      const type = TYPE_BY_NUMBER[out[0] ?? 0]
      if (!type) throw new VoicemeeterError('Voicemeeter is not running. Start it and try again.')
      return type
    },
    isDirty: () => (isDirty() as number) === 1,
    getFloat(param) {
      const out = [0]
      check(getFloat(param, out) as number, param)
      return out[0] ?? 0
    },
    getString(param) {
      const buf = Buffer.alloc(512)
      check(getString(param, buf) as number, param)
      return koffi.decode(buf, 'char', -1) as string
    },
    setFloat: (param, value) => check(setFloat(param, value) as number, param),
    setString: (param, value) => check(setString(param, value) as number, param),
    setParameters: (script) => check(setParameters(script) as number, 'the script'),
    getLevel(kind, channel) {
      const out = [0]
      check(getLevel(kind, channel, out) as number, 'the level')
      return out[0] ?? 0
    },
    setMacroButton: (index, value) =>
      check(macroSet(index, value, 0) as number, `macro button ${index + 1}`),
    logout: () => void logout(),
  }
}
