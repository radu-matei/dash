import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { HurlRunResult } from '../api/client'

export interface TestRun {
  id: string
  file: string
  result: HurlRunResult
  timestamp: number
}

export interface TestVariable {
  key: string
  value: string
}

interface TestRunStore {
  runs: TestRun[]
  addRun: (file: string, result: HurlRunResult) => void
  runsForFile: (file: string) => TestRun[]
  clearRuns: () => void
  variables: TestVariable[]
  setVariables: (vars: TestVariable[]) => void
}

const Ctx = createContext<TestRunStore>({
  runs: [],
  addRun: () => {},
  runsForFile: () => [],
  clearRuns: () => {},
  variables: [],
  setVariables: () => {},
})

const MAX_RUNS = 100

export function TestRunProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<TestRun[]>([])
  const [variables, setVariablesState] = useState<TestVariable[]>(() => {
    try {
      const stored = localStorage.getItem('hurl-test-variables')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })

  const setVariables = useCallback((vars: TestVariable[]) => {
    setVariablesState(vars)
    try { localStorage.setItem('hurl-test-variables', JSON.stringify(vars)) } catch {}
  }, [])

  const addRun = useCallback((file: string, result: HurlRunResult) => {
    setRuns(prev => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      result,
      timestamp: Date.now(),
    }, ...prev].slice(0, MAX_RUNS))
  }, [])

  const runsForFile = useCallback(
    (file: string) => runs.filter(r => r.file === file),
    [runs],
  )

  const clearRuns = useCallback(() => setRuns([]), [])

  return (
    <Ctx.Provider value={{ runs, addRun, runsForFile, clearRuns, variables, setVariables }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTestRuns = () => useContext(Ctx)
