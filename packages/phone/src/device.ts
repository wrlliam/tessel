import awakeVideo from './assets/awake.mp4'

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

/**
 * Keeps the screen on while visible: natively in the iOS app, with Wake Lock where the browser
 * allows it (HTTPS), and otherwise with a tiny muted video playing inline, which stops Safari
 * from dimming over plain http. Browsers only start video after a tap, so it starts on the
 * first touch.
 */
export function keepAwake(): () => void {
  const keep = native()?.KeepAwake
  if (keep) {
    void keep.keepAwake().catch(() => {})
    return () => void keep.allowSleep().catch(() => {})
  }
  if ('wakeLock' in navigator && window.isSecureContext) {
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
  return videoKeepAwake()
}

function videoKeepAwake(): () => void {
  const video = document.createElement('video')
  video.src = awakeVideo
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('aria-hidden', 'true')
  Object.assign(video.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    opacity: '0.01',
    pointerEvents: 'none',
    bottom: '0',
    left: '0',
  })
  document.body.append(video)
  const play = () => void video.play().catch(() => {})
  const onVisible = () => {
    if (document.visibilityState === 'visible') play()
  }
  // Needs a user gesture the first time; every touch is fine, play() is a no-op while playing.
  document.addEventListener('pointerdown', play, { passive: true })
  document.addEventListener('visibilitychange', onVisible)
  play()
  return () => {
    document.removeEventListener('pointerdown', play)
    document.removeEventListener('visibilitychange', onVisible)
    video.pause()
    video.remove()
  }
}

/** Reports where the phone is every few minutes, after the browser asks the person. */
export function watchLocation(
  report: (at: { lat: number; lon: number; accuracy?: number }) => void,
): () => void {
  if (!('geolocation' in navigator)) return () => {}
  let last = 0
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      if (Date.now() - last < 5 * 60_000) return
      last = Date.now()
      report({
        lat: Number(pos.coords.latitude.toFixed(3)),
        lon: Number(pos.coords.longitude.toFixed(3)),
        accuracy: Math.round(pos.coords.accuracy),
      })
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 30_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
