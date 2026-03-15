/**
 * Shared app store — polls /api/app at an adaptive rate.
 *
 * While the app is still starting or has no detected listen address (i.e. Spin
 * hasn't printed its "Serving http://..." line yet), we poll every 2 s so the
 * sidebar link appears as soon as possible. Once the app is running and the
 * address is known we slow down to every 10 s — enough to catch restarts
 * without hammering the server.
 *
 * refresh() forces an immediate re-fetch (used by mutation flows).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getApp, type AppInfo } from '../api/client'

const POLL_FAST = 2_000   // ms — while starting / no listenAddr
const POLL_SLOW = 10_000  // ms — once running and address is known

interface AppContextValue {
  app: AppInfo | null
  refresh: () => void
  /** Signal that Spin is restarting — clears listenAddr and fast-polls until it's back. */
  notifyRestart: () => void
  /** Signal that a build is running before restart. */
  notifyBuilding: () => void
}

const AppCtx = createContext<AppContextValue>({ app: null, refresh: () => {}, notifyRestart: () => {}, notifyBuilding: () => {} })

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppInfo | null>(null)
  const [tick, setTick] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When non-null, we override the displayed status until the backend
  // confirms 'running' again (with a generous timeout as safety net).
  const overrideRef = useRef<{ status: 'restarting' | 'building'; until: number } | null>(null)
  const prevBackendStatus = useRef<string>('running')

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()

    const fetchNow = () => {
      getApp(ctrl.signal)
        .then(info => {
          if (!active) return

          const ov = overrideRef.current

          if (ov) {
            const timedOut = Date.now() > ov.until
            const backendRecovered = info.status === 'running' && prevBackendStatus.current !== 'running'
            prevBackendStatus.current = info.status

            if (timedOut || backendRecovered) {
              overrideRef.current = null
              setApp(info)
            } else {
              // Backend stopped/errored during build → switch label to "restarting"
              const displayStatus = ov.status === 'building' && info.status !== 'running'
                ? 'restarting' as const
                : ov.status
              setApp(prev => prev ? { ...prev, ...info, status: displayStatus } : info)
            }
          } else {
            prevBackendStatus.current = info.status
            setApp(info)
          }

          const settled = !overrideRef.current && info.status === 'running' && !!info.listenAddr
          timerRef.current = setTimeout(fetchNow, settled ? POLL_SLOW : POLL_FAST)
        })
        .catch(() => {
          if (!active) return
          timerRef.current = setTimeout(fetchNow, POLL_FAST)
        })
    }

    fetchNow()

    return () => {
      active = false
      ctrl.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [tick])

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setTick(t => t + 1)
  }, [])

  const notifyRestart = useCallback(() => {
    prevBackendStatus.current = 'restarting'
    overrideRef.current = { status: 'restarting', until: Date.now() + 30_000 }
    setApp(prev => prev ? { ...prev, status: 'restarting' } : prev)
    if (timerRef.current) clearTimeout(timerRef.current)
    setTick(t => t + 1)
  }, [])

  const notifyBuilding = useCallback(() => {
    prevBackendStatus.current = 'building'
    overrideRef.current = { status: 'building', until: Date.now() + 120_000 }
    setApp(prev => prev ? { ...prev, status: 'building' } : prev)
    if (timerRef.current) clearTimeout(timerRef.current)
    setTick(t => t + 1)
  }, [])

  return <AppCtx.Provider value={{ app, refresh, notifyRestart, notifyBuilding }}>{children}</AppCtx.Provider>
}

export const useAppStore = () => useContext(AppCtx)
