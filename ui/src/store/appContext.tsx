/**
 * Shared app store — fetches /api/app once on startup.
 * Exposes refresh() so mutation flows (add component / variable / binding)
 * can force an immediate re-fetch after the spin.toml has been updated.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getApp, type AppInfo } from '../api/client'

interface AppContextValue {
  app: AppInfo | null
  refresh: () => void
}

const AppCtx = createContext<AppContextValue>({ app: null, refresh: () => {} })

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppInfo | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()
    getApp(ctrl.signal)
      .then(info => { if (active) setApp(info) })
      .catch(() => { /* ignore — layout shows "starting" until data arrives */ })
    return () => { active = false; ctrl.abort() }
  }, [tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])

  return <AppCtx.Provider value={{ app, refresh }}>{children}</AppCtx.Provider>
}

export const useAppStore = () => useContext(AppCtx)
