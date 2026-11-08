import { useEffect, useState } from 'react'
import type { DesktopState } from '../../shared/api.ts'

export function useDesktopState(): DesktopState | undefined {
  const [state, setState] = useState<DesktopState>()
  useEffect(() => {
    let live = true
    const off = window.tessel.onState(setState)
    void window.tessel.getState().then((s) => live && setState(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

/** Re-renders every `ms` so countdowns and relative times stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
