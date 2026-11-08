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

export function haptic() {
  // iOS Safari has no Vibration API; this is a no-op there.
  navigator.vibrate?.(10)
}

/** Keeps the screen on while visible. Needs a secure context, so plain-http LAN pages skip it. */
export function keepAwake(): () => void {
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
