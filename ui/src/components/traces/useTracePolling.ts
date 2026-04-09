import { useEffect, useRef, useState, useCallback } from 'react'
import { getTraces, type Span } from '../../api/client'

export function useTracePolling() {
  const [allSpans, setAllSpans] = useState<Span[]>([])
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Resolves when unpaused — allows the polling loop to await when paused.
  const unpauseRef = useRef<(() => void) | null>(null)

  // Ref that the refresh button can call to skip the current sleep and fetch immediately.
  const wakeRef = useRef<(() => void) | null>(null)

  const refresh = useCallback(() => {
    wakeRef.current?.()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    let active = true

    const run = async () => {
      while (active) {
        // If paused, wait until unpaused before fetching.
        if (pausedRef.current) {
          await new Promise<void>(res => { unpauseRef.current = res })
          unpauseRef.current = null
          if (!active) break
        }

        try {
          setAllSpans((await getTraces(ctrl.signal)) ?? [])
          setError(null)
        } catch (e: unknown) {
          if ((e as Error).name === 'AbortError') break
          setError((e as Error).message)
        }

        // Sleep 3s, but allow early wake via wakeRef (refresh button).
        await new Promise<void>(res => {
          const t = setTimeout(res, 3000)
          wakeRef.current = () => { clearTimeout(t); res() }
          ctrl.signal.addEventListener('abort', () => { clearTimeout(t); res() })
        })
        wakeRef.current = null
      }
    }

    run()
    return () => { active = false; ctrl.abort() }
  }, [])

  // When unpausing, wake the polling loop from its pause-wait.
  useEffect(() => {
    if (!paused && unpauseRef.current) {
      unpauseRef.current()
    }
  }, [paused])

  return { allSpans, error, paused, setPaused, refresh }
}
