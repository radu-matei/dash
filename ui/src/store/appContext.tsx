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
}

const AppCtx = createContext<AppContextValue>({ app: null, refresh: () => {}, notifyRestart: () => {} })

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppInfo | null>(null)
  const [tick, setTick] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartingRef = useRef(false)

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()

    const fetchNow = () => {
      getApp(ctrl.signal)
        .then(info => {
          if (!active) return
          if (restartingRef.current) {
            if (info.listenAddr) {
              restartingRef.current = false
              setApp(info)
            } else {
              setApp(prev => prev ? { ...prev, ...info, listenAddr: undefined, status: 'starting' } : info)
            }
          } else {
            setApp(info)
          }
          const settled = !restartingRef.current && info.status === 'running' && !!info.listenAddr
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
    restartingRef.current = true
    setApp(prev => prev ? { ...prev, listenAddr: undefined, status: 'starting' } : prev)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setTick(t => t + 1), 500)
  }, [])

  return <AppCtx.Provider value={{ app, refresh, notifyRestart }}>{children}</AppCtx.Provider>
}

export const useAppStore = () => useContext(AppCtx)
