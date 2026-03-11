/**
 * Shared log store — single SSE connection + history, used by both
 * LogViewer and TraceViewer (related-logs panel).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { subscribeToLogs, type LogLine } from '../api/client'

const MAX = 12_000

interface LogContextValue {
  rawLines: LogLine[]
  clear: () => void
}

const LogContext = createContext<LogContextValue>({ rawLines: [], clear: () => {} })

export function LogProvider({ children }: { children: ReactNode }) {
  const [rawLines, setRawLines] = useState<LogLine[]>([])

  useEffect(() => {
    let active = true

    // Live stream only — stamp each line with the arrival time so the
    // log viewer can show a timestamp even when the line has none.
    const es = subscribeToLogs(line => {
      if (!active) return
      const stamped = { ...line, receivedAt: Date.now() }
      setRawLines(prev => {
        const next = [...prev, stamped]
        return next.length > MAX ? next.slice(-MAX) : next
      })
    })

    return () => {
      active = false
      es.close()
    }
  }, [])

  const clear = () => setRawLines([])

  return (
    <LogContext.Provider value={{ rawLines, clear }}>
      {children}
    </LogContext.Provider>
  )
}

export const useLogStore = () => useContext(LogContext)
