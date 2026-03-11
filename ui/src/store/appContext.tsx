/**
 * Shared app store — fetches /api/app once on startup.
 * App structure (components, triggers, variables) never changes while spin is running.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getApp, type AppInfo } from '../api/client'

interface AppContextValue {
  app: AppInfo | null
}

const AppCtx = createContext<AppContextValue>({ app: null })

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()
    getApp(ctrl.signal)
      .then(info => { if (active) setApp(info) })
      .catch(() => { /* ignore — layout shows "starting" until data arrives */ })
    return () => { active = false; ctrl.abort() }
  }, [])

  return <AppCtx.Provider value={{ app }}>{children}</AppCtx.Provider>
}

export const useAppStore = () => useContext(AppCtx)
