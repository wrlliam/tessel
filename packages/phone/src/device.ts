const TOKEN_KEY = 'tessel.token'

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked; nothing to clear.
  }
}

export function guessDeviceName(ua = navigator.userAgent): string {
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android phone'
  return 'Phone'
}

/** True when launched from the iOS Home Screen. */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export const isIosSafari = (ua = navigator.userAgent) =>
  /iPhone|iPad/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)

interface NativePlugins {
  Haptics?: { impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void> }
  KeepAwake?: { keepAwake(): Promise<void>; allowSleep(): Promise<void> }
}

/** Plugins from Tessel's iOS app, when this page runs inside it rather than in Safari. */
function native(): NativePlugins | undefined {
  const cap = (window as { Capacitor?: { isNativePlatform?(): boolean; Plugins?: NativePlugins } })
    .Capacitor
  return cap?.isNativePlatform?.() ? cap.Plugins : undefined
}

export const inNativeApp = () => native() !== undefined

/** Leaves the phone page for the iOS app's start screen, to pick another computer. */
export function chooseAnotherComputer() {
  window.location.href = 'capacitor://localhost/?pick=1'
}

export function haptic() {
  const haptics = native()?.Haptics
  if (haptics) {
    void haptics.impact({ style: 'LIGHT' }).catch(() => {})
    return
  }
  // iOS Safari has no Vibration API; this is a no-op there.
  navigator.vibrate?.(10)
}

/** Keeps the screen on while visible: natively in the iOS app, otherwise via Wake Lock (HTTPS only). */
export function keepAwake(): () => void {
  const keep = native()?.KeepAwake
  if (keep) {
    void keep.keepAwake().catch(() => {})
    return () => void keep.allowSleep().catch(() => {})
  }
  if (!('wakeLock' in navigator)) return () => {}
  let sentinel: WakeLockSentinel | undefined
  const request = () => {
    if (document.visibilityState !== 'visible') return
    navigator.wakeLock
      .request('screen')
      .then((s) => (sentinel = s))
      .catch(() => {})
  }
  request()
  document.addEventListener('visibilitychange', request)
  return () => {
    document.removeEventListener('visibilitychange', request)
    void sentinel?.release()
  }
}
