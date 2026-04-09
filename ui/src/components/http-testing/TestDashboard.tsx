import { useState } from 'react'
import {
  AlertCircle, Check, ChevronRight, FlaskConical, Loader2, Lock, Play, Plus, X,
} from 'lucide-react'
import type { HurlTestFile, HurlTestListResponse, HurlRunResult } from '../../api/client'
import { runHurlTest } from '../../api/client'
import { fmtDuration, timeAgo } from './types'
import { HurlIcon } from './HurlEditor'

// ─── Status helpers ─────────────────────────────────────────────────────────

function statusIcon(lastRun?: HurlRunResult) {
  if (!lastRun) return <div className="w-3 h-3 rounded-full bg-gray-300" title="Never run" />
  if (lastRun.success) return <Check className="w-3.5 h-3.5 text-green-600" />
  return <X className="w-3.5 h-3.5 text-red-500" />
}

function statusColor(lastRun?: HurlRunResult): string {
  if (!lastRun) return 'border-gray-200'
  if (lastRun.success) return 'border-green-300'
  return 'border-red-300'
}

// ─── Summary stats ──────────────────────────────────────────────────────────

function SummaryBar({ files }: { files: HurlTestFile[] }) {
  const passed = files.filter(f => f.lastRun?.success === true).length
  const failed = files.filter(f => f.lastRun && !f.lastRun.success).length
  const notRun = files.filter(f => !f.lastRun).length
  const total = files.length

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-gray-600">
        {total} {total === 1 ? 'test' : 'tests'}
      </span>
      {passed > 0 && (
        <span className="flex items-center gap-1 text-xs text-green-700">
          <Check className="w-3 h-3" /> {passed} passed
        </span>
      )}
      {failed > 0 && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <X className="w-3 h-3" /> {failed} failed
        </span>
      )}
      {notRun > 0 && (
        <span className="text-xs text-gray-400">{notRun} not run</span>
      )}

      {/* Progress bar */}
      {total > 0 && (
        <div className="flex-1 max-w-xs h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
          {passed > 0 && (
            <div className="bg-green-500 h-full" style={{ width: `${(passed / total) * 100}%` }} />
          )}
          {failed > 0 && (
            <div className="bg-red-500 h-full" style={{ width: `${(failed / total) * 100}%` }} />
          )}
          {notRun > 0 && (
            <div className="bg-gray-300 h-full" style={{ width: `${(notRun / total) * 100}%` }} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Test file card ─────────────────────────────────────────────────────────

function TestFileCard({
  file,
  running,
  onRun,
  onOpen,
}: {
  file: HurlTestFile
  running: boolean
  onRun: () => void
  onOpen: () => void
}) {
  const lastRun = file.lastRun

  return (
    <div
      onClick={onOpen}
      className={`card card-hover cursor-pointer border-l-4 ${statusColor(lastRun)} transition-all`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {statusIcon(lastRun)}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <HurlIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-sm font-mono font-medium text-gray-800 truncate">{file.name}</span>
              </div>
              {file.dir !== '.' && (
                <span className="text-[10px] text-gray-400 font-mono">{file.dir}/</span>
              )}
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onRun() }}
            disabled={running}
            className="btn-secondary text-xs h-7 px-2.5 shrink-0"
            title="Run this test"
          >
            {running
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Play className="w-3 h-3" />
            }
          </button>
        </div>

        {/* Result details */}
        <div className="mt-2 flex items-center gap-3 text-xs">
          {lastRun ? (
            <>
              <span className={`font-mono font-medium ${lastRun.success ? 'text-green-700' : 'text-red-600'}`}>
                {lastRun.success ? 'Passed' : 'Failed'}
              </span>
              <span className="text-gray-400">{fmtDuration(lastRun.durationMs)}</span>
              <span className="text-gray-400">{timeAgo(lastRun.endTimeMs)}</span>
            </>
          ) : (
            <span className="text-gray-400 italic">Never run</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main dashboard ─────────────────────────────────────────────────────────

export default function TestDashboard({
  testList,
  canEdit,
  hurlInstalled,
  variables,
  onSelectFile,
  onNewTest,
  onRefresh,
  onAddRun,
}: {
  testList: HurlTestListResponse
  canEdit: boolean
  hurlInstalled: boolean
  variables: { key: string; value: string }[]
  onSelectFile: (path: string) => void
  onNewTest: () => void
  onRefresh: () => void
  onAddRun: (file: string, result: HurlRunResult) => void
}) {
  const [runningAll, setRunningAll] = useState(false)
  const [runProgress, setRunProgress] = useState({ current: 0, total: 0 })
  const [runningFile, setRunningFile] = useState<string | null>(null)

  const files = testList.files

  const handleRunAll = async () => {
    if (!hurlInstalled || files.length === 0) return
    setRunningAll(true)
    setRunProgress({ current: 0, total: files.length })

    const vars: Record<string, string> = {}
    for (const v of variables) { if (v.key) vars[v.key] = v.value }

    for (let i = 0; i < files.length; i++) {
      setRunProgress({ current: i + 1, total: files.length })
      setRunningFile(files[i].path)
      try {
        const result = await runHurlTest(files[i].path, Object.keys(vars).length > 0 ? vars : undefined)
        onAddRun(files[i].path, result)
      } catch {
        // Continue running remaining tests even if one fails
      }
      // Refresh after each file so cards update in real-time
      onRefresh()
    }

    setRunningFile(null)
    setRunningAll(false)
  }

  const handleRunSingle = async (path: string) => {
    setRunningFile(path)
    const vars: Record<string, string> = {}
    for (const v of variables) { if (v.key) vars[v.key] = v.value }
    try {
      const result = await runHurlTest(path, Object.keys(vars).length > 0 ? vars : undefined)
      onAddRun(path, result)
    } catch {
      // error handled by refreshing
    }
    setRunningFile(null)
    onRefresh()
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4 px-8">
        <FlaskConical className="w-12 h-12 opacity-20" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-gray-500">HTTP Testing with Hurl</p>
          <p className="text-xs text-gray-400 max-w-sm">
            Create and run HTTP tests for your Spin app. Tests are powered by{' '}
            <a href="https://hurl.dev" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline">Hurl</a>
            {' '}and results link directly to traces.
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit ? (
            <button onClick={onNewTest} className="btn-accent text-xs h-8 px-4">
              <Plus className="w-3.5 h-3.5" /> New Test
            </button>
          ) : (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <Lock className="w-3 h-3 shrink-0" />
              Pass <code className="font-mono">--allow-edits</code> to create tests
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Hurl not installed banner */}
      {!hurlInstalled && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg shrink-0">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800">Hurl is not installed</p>
              <p className="text-xs text-amber-700">
                Install it from{' '}
                <a href="https://hurl.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">hurl.dev</a>
              </p>
              <pre className="text-xs font-mono bg-amber-100 px-2 py-1 rounded mt-1 text-amber-900">brew install hurl</pre>
            </div>
          </div>
        </div>
      )}

      {/* Summary + Run All */}
      <div className="px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <SummaryBar files={files} />
          <button
            onClick={handleRunAll}
            disabled={runningAll || !hurlInstalled}
            className="btn-primary text-xs h-8 px-4"
          >
            {runningAll ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Running {runProgress.current}/{runProgress.total}...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run All
              </>
            )}
          </button>
        </div>
      </div>

      {/* Test file cards */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {files.map(file => (
            <TestFileCard
              key={file.path}
              file={file}
              running={runningFile === file.path}
              onRun={() => handleRunSingle(file.path)}
              onOpen={() => onSelectFile(file.path)}
            />
          ))}
        </div>

        {/* Hint to open editor */}
        <p className="text-xs text-gray-400 text-center mt-6 flex items-center justify-center gap-1">
          Click a card to open in the editor
          <ChevronRight className="w-3 h-3" />
        </p>
      </div>
    </div>
  )
}
