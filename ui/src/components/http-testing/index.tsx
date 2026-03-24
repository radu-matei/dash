import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, Braces, Check, Loader2, Lock, Minus, Play, Plus, RefreshCw, Save, X,
} from 'lucide-react'
import { useAppStore } from '../../store/appContext'
import { useTestRuns } from '../../store/testRunContext'
import ResizablePanel from '../ResizablePanel'
import {
  type HurlTestListResponse,
  type VarEntry,
  getHurlTests, getHurlFile, saveHurlFile, runHurlTest,
  getVars,
} from '../../api/client'
import HurlEditor, { HurlIcon } from './HurlEditor'
import NewTestBuilder from './NewTestBuilder'
import RunOutput from './RunOutput'
import TestDashboard from './TestDashboard'
import TestFileSidebar from './TestFileSidebar'
import { fmtDuration, httpRoutes } from './types'

// ─── Main component ──────────────────────────────────────────────────────────

export default function HttpTesting() {
  const { app } = useAppStore()
  const navigate = useNavigate()

  const [testList, setTestList] = useState<HurlTestListResponse | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [viewingRunIndex, setViewingRunIndex] = useState(0)
  const [editorHeight, setEditorHeight] = useState(300)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  const { addRun, runsForFile, variables, setVariables } = useTestRuns()
  const [showVars, setShowVars] = useState(false)
  const [spinVars, setSpinVars] = useState<VarEntry[]>([])

  useEffect(() => {
    getVars().then(setSpinVars).catch(() => {})
  }, [])

  const routes = useMemo(() => httpRoutes(app?.triggers ?? []), [app?.triggers])
  const hasUnsavedChanges = fileContent !== originalContent
  const canEdit = app?.allowMutations ?? false
  const fileRuns = useMemo(() => selectedPath ? runsForFile(selectedPath) : [], [selectedPath, runsForFile])
  const displayedRun = fileRuns[viewingRunIndex] ?? null

  // ── Fetch test list ──────────────────────────────
  const refreshList = useCallback(async () => {
    try {
      const data = await getHurlTests()
      setTestList(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshList() }, [refreshList])

  // ── Select & load a file ────────────────────────
  const selectFile = useCallback(async (path: string) => {
    try {
      setError(null)
      setViewingRunIndex(0)
      const file = await getHurlFile(path)
      setSelectedPath(path)
      const content = file.content ?? ''
      setFileContent(content)
      setOriginalContent(content)
      setShowBuilder(false)
      const vars = content.match(/\{\{(\w+)\}\}/g)
      if (vars?.some(v => v !== '{{base_url}}')) setShowVars(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // ── Save file ───────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedPath) return
    setSaving(true)
    try {
      await saveHurlFile(selectedPath, fileContent)
      setOriginalContent(fileContent)
      setError(null)
      refreshList()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [selectedPath, fileContent, refreshList])

  // ── Run test ────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!selectedPath) return
    if (hasUnsavedChanges) {
      try {
        await saveHurlFile(selectedPath, fileContent)
        setOriginalContent(fileContent)
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setRunning(true)
    setError(null)
    try {
      const vars: Record<string, string> = {}
      for (const v of variables) { if (v.key) vars[v.key] = v.value }
      const result = await runHurlTest(selectedPath, Object.keys(vars).length > 0 ? vars : undefined)
      addRun(selectedPath, result)
      setViewingRunIndex(0)
      refreshList() // refresh to update lastRun status
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [selectedPath, fileContent, hasUnsavedChanges, addRun, variables, refreshList])

  // ── Save from builder ───────────────────────────
  const handleBuilderSave = useCallback(async (path: string, content: string) => {
    try {
      const result = await saveHurlFile(path, content)
      setShowBuilder(false)
      await refreshList()
      await selectFile(result.path)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [refreshList, selectFile])

  // ── Navigate to traces ──────────────────────────
  const viewTraces = useCallback(() => {
    if (!displayedRun) { navigate('/traces'); return }
    const r = displayedRun.result
    const buffer = 1000
    const params = new URLSearchParams({
      from: String(r.startTimeMs - buffer),
      to:   String(r.endTimeMs + buffer),
      label: selectedPath ?? 'test run',
    })
    navigate(`/traces?${params}`)
  }, [navigate, displayedRun, selectedPath])

  // ── Back to dashboard ───────────────────────────
  const goToDashboard = useCallback(() => {
    setSelectedPath(null)
    setShowBuilder(false)
    refreshList()
  }, [refreshList])

  // ── Keyboard shortcuts ──────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && selectedPath) {
        e.preventDefault()
        handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedPath) {
        e.preventDefault()
        handleRun()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedPath, handleSave, handleRun])

  // ── Drag-to-resize editor/results split ─────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - dragStartY.current
      setEditorHeight(Math.max(80, Math.min(800, dragStartH.current + delta)))
    }
    const onUp = () => { isDragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Builder view ────────────────────────────────
  if (showBuilder) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-white">
        <NewTestBuilder
          routes={routes}
          defaultDir={testList?.defaultDir ?? 'tests'}
          onSave={handleBuilderSave}
          onCancel={() => setShowBuilder(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* ── Toolbar ────────────────────────────────── */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          {selectedPath && (
            <button
              onClick={goToDashboard}
              className="text-xs text-gray-400 hover:text-gray-600 mr-1"
              title="Back to dashboard"
            >
              ← All Tests
            </button>
          )}
          <h1 className="page-title">HTTP Tests</h1>
          {testList && (
            <span className="badge badge-gray">{testList.files.length} file{testList.files.length !== 1 ? 's' : ''}</span>
          )}
          {testList && !testList.hurlInstalled && (
            <span className="badge badge-yellow">hurl not installed</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVars(v => !v)}
            className={`btn text-xs h-8 px-2.5 ${
              showVars || variables.some(v => v.key)
                ? 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'
                : 'btn-secondary'
            }`}
            title="Test variables — injected into {{variable}} placeholders"
          >
            <Braces className="w-3.5 h-3.5" />
            Variables
            {variables.filter(v => v.key).length > 0 && (
              <span className="ml-0.5 font-semibold">{variables.filter(v => v.key).length}</span>
            )}
          </button>
          {canEdit ? (
            <button onClick={() => setShowBuilder(true)} className="btn-primary text-xs h-8 px-3">
              <Plus className="w-3.5 h-3.5" /> New Test
            </button>
          ) : (
            <span
              className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5"
              title="Restart with --allow-edits to enable creating and editing tests"
            >
              <Lock className="w-3 h-3 shrink-0" />
              Read-only — pass <code className="font-mono">--allow-edits</code> to edit
            </span>
          )}
          <button onClick={() => refreshList()} className="btn-secondary text-xs h-8 px-2.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Variables panel */}
      {showVars && (
        <div className="border-b border-gray-200 bg-orange-50/40 px-6 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Braces className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-xs font-semibold text-gray-700">Test Variables</span>
              <span className="text-xs text-gray-400">
                — use <code className="font-mono text-orange-600 bg-orange-100 px-1 rounded">{'{{key}}'}</code> in .hurl files
              </span>
            </div>
            <button
              onClick={() => setVariables([...variables, { key: '', value: '' }])}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {/* Spin variable suggestions */}
          {(() => {
            const usedKeys = new Set(variables.map(v => v.key))
            const suggestions = spinVars.filter(sv => sv.declared && !usedKeys.has(sv.key))
            if (suggestions.length === 0) return null
            return (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide mr-0.5">Spin variables:</span>
                {suggestions.map(sv => (
                  <button
                    key={sv.key}
                    onClick={() => setVariables([...variables, { key: sv.key, value: sv.value }])}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                    title={sv.value ? `Value: ${sv.value} (from ${sv.source})` : `No default value (${sv.source}) — you'll need to provide one`}
                  >
                    <Plus className="w-2.5 h-2.5" />
                    {sv.key}
                    {sv.value
                      ? <Check className="w-2.5 h-2.5 text-emerald-500" />
                      : <span className="text-amber-500 text-[10px]">no value</span>
                    }
                  </button>
                ))}
              </div>
            )
          })()}

          {variables.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              {spinVars.some(sv => sv.declared)
                ? <>Click a Spin variable above, or add custom ones with <strong>+ Add</strong>.</>
                : <>No variables defined. Add variables and reference them as <code className="font-mono text-orange-600">{'{{key}}'}</code> in .hurl files.</>
              }
            </p>
          ) : (
            <div className="space-y-1.5">
              {variables.map((v, i) => {
                const spinMatch = spinVars.find(sv => sv.key === v.key && sv.declared)
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={`input-mono text-xs py-1 w-40 ${spinMatch ? 'border-emerald-300 bg-emerald-50/50' : ''}`}
                      placeholder="variable name"
                      value={v.key}
                      onChange={e => setVariables(variables.map((old, j) => j === i ? { ...old, key: e.target.value } : old))}
                    />
                    <span className="text-gray-400 text-xs">=</span>
                    <input
                      className="input-mono text-xs py-1 flex-1"
                      placeholder={spinMatch ? `from ${spinMatch.source}` : 'value'}
                      type={v.key.toLowerCase().includes('token') || v.key.toLowerCase().includes('secret') || v.key.toLowerCase().includes('password') || v.key.toLowerCase().includes('auth') ? 'password' : 'text'}
                      value={v.value}
                      onChange={e => setVariables(variables.map((old, j) => j === i ? { ...old, value: e.target.value } : old))}
                    />
                    {spinMatch && (
                      <span className="text-[10px] text-emerald-500 shrink-0" title={`Matches Spin variable from ${spinMatch.source}`}>
                        spin
                      </span>
                    )}
                    <button
                      onClick={() => setVariables(variables.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">
            <code className="font-mono">base_url</code> is injected automatically when your Spin app is running.
            Variables persist across refreshes.
          </p>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : !selectedPath ? (
        /* ── Dashboard landing ─────────────────────── */
        testList && (
          <TestDashboard
            testList={testList}
            canEdit={canEdit}
            hurlInstalled={testList.hurlInstalled}
            variables={variables}
            onSelectFile={selectFile}
            onNewTest={() => setShowBuilder(true)}
            onRefresh={refreshList}
            onAddRun={addRun}
          />
        )
      ) : (
        /* ── Editor view with sidebar ─────────────── */
        <ResizablePanel
          storageKey="hurl-file-sidebar"
          defaultWidth={288}
          minWidth={180}
          maxWidth={400}
          panel={
            <TestFileSidebar
              files={testList?.files ?? []}
              selectedPath={selectedPath}
              canEdit={canEdit}
              onSelectFile={selectFile}
              onNewTest={() => setShowBuilder(true)}
            />
          }
        >
          {/* ── Main content ────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Editor header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <HurlIcon className="w-4 h-4 shrink-0" />
                <span className="text-sm font-mono text-gray-700 truncate">{selectedPath}</span>
                {hasUnsavedChanges && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                )}
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges}
                    className="btn-secondary text-xs h-7 px-2.5"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save
                  </button>
                )}
                <button
                  onClick={handleRun}
                  disabled={running || !testList?.hurlInstalled}
                  className="btn-blue text-xs h-7 px-3"
                  title={!testList?.hurlInstalled ? 'Install hurl first' : 'Run test (⌘Enter)'}
                >
                  {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Run
                </button>
              </div>
            </div>

            {/* Editor + results split */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Highlighted editor */}
              <div
                className="overflow-hidden flex flex-col shrink-0"
                style={displayedRun ? { height: editorHeight } : { flex: 1 }}
              >
                <HurlEditor
                  value={fileContent}
                  onChange={setFileContent}
                  readOnly={!canEdit}
                  placeholder="# Write your Hurl test here\n# Tip: use {{base_url}} for the Spin app address\n\nGET {{base_url}}/\nHTTP 200"
                />
              </div>

              {/* Resize handle */}
              {displayedRun && (
                <div
                  className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200 active:bg-blue-300 transition-colors flex items-center justify-center group"
                  onMouseDown={e => {
                    isDragging.current = true
                    dragStartY.current = e.clientY
                    dragStartH.current = editorHeight
                    document.body.style.cursor = 'row-resize'
                    e.preventDefault()
                  }}
                >
                  <div className="w-10 h-0.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
                </div>
              )}

              {/* Run results */}
              {displayedRun && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  {/* Run history bar */}
                  {fileRuns.length > 1 && (
                    <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0 overflow-x-auto">
                      <span className="text-xs text-gray-400 shrink-0 mr-0.5">Runs:</span>
                      {fileRuns.map((run, i) => {
                        const time = new Date(run.timestamp).toLocaleTimeString('en-US', {
                          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })
                        const isActive = i === viewingRunIndex
                        return (
                          <button
                            key={run.id}
                            onClick={() => setViewingRunIndex(i)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors shrink-0 ${
                              isActive
                                ? run.result.success
                                  ? 'bg-green-100 text-green-800 ring-1 ring-green-300'
                                  : 'bg-red-100 text-red-800 ring-1 ring-red-300'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {run.result.success
                              ? <Check className="w-3 h-3 text-green-600" />
                              : <X className="w-3 h-3 text-red-500" />
                            }
                            {time}
                            <span className="text-gray-400">{fmtDuration(run.result.durationMs)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <RunOutput result={displayedRun.result} onViewTraces={viewTraces} variables={variables} />
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      )}
    </div>
  )
}
