import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity, AlertCircle, ArrowUpDown, Copy, Check, GitCompareArrows,
  ExternalLink, FlaskConical, Pause, Search, X,
} from 'lucide-react'
import { getApp, type AppInfo } from '../../api/client'
import ComponentTabs from '../ComponentTabs'
import type { TraceGroup } from './types'
import { buildColorMap, buildRouteMap, groupTraces, fmtTime } from './traceUtils'
import { useTracePolling } from './useTracePolling'
import TraceList from './TraceList'
import Waterfall from './Waterfall'
import RelatedLogs from './RelatedLogs'
import DurationChart from './DurationChart'
import TraceComparison from './TraceComparison'

// ─── Copy button helper ──────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }
  return (
    <button
      onClick={e => { e.stopPropagation(); copy() }}
      className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors"
      title={label ? `Copy ${label}` : 'Copy'}
    >
      {copied
        ? <Check className="w-3 h-3 text-green-500" />
        : <Copy className="w-3 h-3" />
      }
    </button>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function TraceViewer() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { allSpans, error, paused, setPaused } = useTracePolling()
  const [appInfo, setAppInfo]     = useState<AppInfo | null>(null)
  const [selected, setSelected]   = useState<string | null>(null)
  const [filter, setFilter]       = useState('')
  const [errorsOnly, setErrorsOnly] = useState(() => searchParams.get('errors') === '1')
  const [sortBy, setSortBy]       = useState<'recent' | 'longest'>('recent')
  const [compareMode, setCompareMode] = useState(false)
  const [compareTraces, setCompareTraces] = useState<[string, string] | null>(null)

  // Time-window filter from URL (used by HTTP Tests "View Traces" links).
  const timeFrom  = searchParams.get('from') ? Number(searchParams.get('from')) : null
  const timeTo    = searchParams.get('to')   ? Number(searchParams.get('to'))   : null
  const timeLabel = searchParams.get('label') ?? null
  const hasTimeFilter = timeFrom !== null && timeTo !== null

  const clearTimeFilter = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('from')
      next.delete('to')
      next.delete('label')
      return next
    }, { replace: true })
  }
  const [activeTab, setActiveTab] = useState<'waterfall' | 'logs'>('waterfall')
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(192) // px – resizable trace-list height
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)
  const navigate = useNavigate()

  // Auto-pause when a trace is selected, resume when deselected.
  const prevSelected = useRef<string | null>(null)
  useEffect(() => {
    if (selected && !prevSelected.current) {
      setPaused(true)
    } else if (!selected && prevSelected.current) {
      setPaused(false)
    }
    prevSelected.current = selected
  }, [selected, setPaused])

  // Drag-to-resize the trace list / detail-panel split.
  // Min 0 so the detail panel can take the full height.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - dragStartY.current
      const maxH = (containerRef.current?.clientHeight ?? 800) - 6
      setListHeight(Math.max(0, Math.min(maxH, dragStartH.current + delta)))
    }
    const onUp = () => { isDragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // Fetch app manifest once to build the route→component map.
  useEffect(() => {
    getApp().then(setAppInfo).catch(() => {})
  }, [])

  const routeMap = useMemo(() => buildRouteMap(appInfo), [appInfo])
  const colorMap = useMemo(() => buildColorMap(allSpans), [allSpans])

  const [compFilter, setCompFilterRaw] = useState(() => searchParams.get('component') ?? 'all')

  const setCompFilter = useCallback((tab: string) => {
    setCompFilterRaw(tab)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (tab === 'all') next.delete('component')
      else next.set('component', tab)
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    const comp = searchParams.get('component')
    if (comp && comp !== compFilter) setCompFilterRaw(comp)
    else if (!comp && compFilter !== 'all') setCompFilterRaw('all')
  }, [searchParams])

  const allGrouped = useMemo(() => groupTraces(allSpans, routeMap), [allSpans, routeMap])

  const traceComponents = useMemo(() => {
    const set = new Set<string>()
    for (const t of allGrouped) for (const c of t.components) set.add(c)
    return Array.from(set).sort()
  }, [allGrouped])

  const traces = useMemo(() => {
    let all = allGrouped
    if (hasTimeFilter) {
      all = all.filter(t => t.startMs >= timeFrom! && t.startMs <= timeTo!)
    }
    if (errorsOnly) all = all.filter(t => t.hasErrors)
    if (compFilter !== 'all') all = all.filter(t => t.components.has(compFilter))
    if (filter) {
      const q = filter.toLowerCase()
      all = all.filter(t =>
        t.rootName.toLowerCase().includes(q) ||
        t.component.toLowerCase().includes(q) ||
        Array.from(t.components).some(c => c.toLowerCase().includes(q)) ||
        t.traceId.includes(q) ||
        t.spans.some(s =>
          s.name?.toLowerCase().includes(q) ||
          Object.entries(s.attrs ?? {}).some(([k, v]) =>
            k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
          ) ||
          (s.events ?? []).some(ev =>
            ev.name?.toLowerCase().includes(q) ||
            Object.values(ev.attrs ?? {}).some(v => String(v).toLowerCase().includes(q))
          )
        )
      )
    }
    if (sortBy === 'longest') {
      all = [...all].sort((a, b) => b.durationMs - a.durationMs)
    }
    return all
  }, [allGrouped, filter, errorsOnly, hasTimeFilter, timeFrom, timeTo, compFilter, sortBy])

  // Auto-select the first trace when arriving via a time-window deep link.
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (hasTimeFilter && traces.length > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true
      setSelected(traces[0].traceId)
    }
  }, [hasTimeFilter, traces])

  const selectedTrace = useMemo(() => traces.find(t => t.traceId === selected) ?? null, [traces, selected])
  const maxDuration   = useMemo(() => Math.max(...traces.map(t => t.durationMs), 1), [traces])
  const errorCount    = traces.filter(t => t.hasErrors).length

  const openInLogs = (trace: TraceGroup) => {
    const params = new URLSearchParams({
      from: String(trace.startMs - 500),
      to:   String(trace.endMs + 500),
      label: trace.rootName,
    })
    navigate(`/logs?${params}`)
  }

  const handleSelect = (traceId: string | null) => {
    if (compareMode && traceId) {
      setCompareTraces(prev => {
        if (!prev) return [traceId, ''] as [string, string]
        if (prev[0] === traceId) return null // deselect
        return [prev[0], traceId]
      })
      return
    }
    setSelected(traceId)
    setSelectedSpanId(null)
    setActiveTab('waterfall')
  }

  const exitCompareMode = () => {
    setCompareMode(false)
    setCompareTraces(null)
  }

  const compareTraceA = compareTraces?.[0] ? traces.find(t => t.traceId === compareTraces[0]) ?? null : null
  const compareTraceB = compareTraces?.[1] ? traces.find(t => t.traceId === compareTraces[1]) ?? null : null

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Traces</h1>
          {traces.length > 0 && (
            <>
              <span className="badge badge-gray badge-sm rounded-full">{traces.length}</span>
              {errorCount > 0 && <span className="badge badge-red badge-sm rounded-full">{errorCount} with errors</span>}
              <DurationChart traces={traces} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Sort / Errors / Compare — segment control */}
          <div className="tab-group">
            <button
              onClick={() => setSortBy(s => s === 'recent' ? 'longest' : 'recent')}
              className={`tab ${sortBy === 'longest' ? 'tab-active' : ''}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortBy === 'longest' ? 'Longest first' : 'Most recent'}
            </button>

            <button
              onClick={() => setErrorsOnly(v => !v)}
              className={`tab ${errorsOnly ? 'tab-active' : ''}`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Errors only
              {errorsOnly && <span className="ml-1 font-semibold">✓</span>}
            </button>

            <button
              onClick={() => compareMode ? exitCompareMode() : (setCompareMode(true), setSelected(null))}
              className={`tab ${compareMode ? 'tab-active' : ''}`}
              title={compareMode ? 'Exit compare mode' : 'Compare two traces'}
            >
              <GitCompareArrows className="w-3.5 h-3.5" />
              {compareMode ? 'Comparing' : 'Compare'}
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input text-xs py-1 pl-8 h-8 w-56"
              placeholder="Search traces…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          {/* Live / Pause toggle */}
          <div className="tab-group">
            <button
              onClick={() => setPaused(false)}
              className={`tab ${!paused ? 'tab-active' : ''}`}
              title="Live updates"
            >
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full bg-green-400 ${!paused ? 'animate-ping opacity-75' : 'opacity-0'}`} />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Live
            </button>
            <button
              onClick={() => setPaused(true)}
              className={`tab ${paused ? 'tab-active' : ''}`}
              title="Pause live updates"
            >
              <Pause className="w-3.5 h-3.5" />
              Paused
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {hasTimeFilter && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center gap-2 shrink-0">
          <FlaskConical className="w-4 h-4 shrink-0 text-blue-500" />
          <span className="flex-1">
            Showing traces from{' '}
            {timeLabel ? <strong>{timeLabel}</strong> : 'test run'}
            {' '}({fmtTime(timeFrom!)} — {fmtTime(timeTo!)})
            {traces.length > 0
              ? <> · <strong>{traces.length}</strong> trace{traces.length !== 1 ? 's' : ''}</>
              : ' · waiting for traces…'
            }
          </span>
          <button
            onClick={clearTimeFilter}
            className="btn-secondary text-xs h-6 px-2 shrink-0"
          >
            <X className="w-3 h-3" /> Show all
          </button>
        </div>
      )}

      {traceComponents.length > 0 && (
        <ComponentTabs
          componentIds={traceComponents}
          activeTab={compFilter}
          onTabChange={setCompFilter}
          allTab={{ label: 'All components' }}
          trailing={<>{traces.length} trace{traces.length !== 1 ? 's' : ''}</>}
        />
      )}

      {/* Compare mode banner */}
      {compareMode && (
        <div className="mx-4 mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800 flex items-center gap-2 shrink-0">
          <GitCompareArrows className="w-4 h-4 shrink-0 text-purple-500" />
          <span className="flex-1">
            {!compareTraces || !compareTraces[1]
              ? <>Select <strong>two traces</strong> to compare. {compareTraces?.[0] ? 'Pick a second trace.' : 'Pick the first trace.'}</>
              : <>Comparing <strong>Trace A</strong> vs <strong>Trace B</strong></>
            }
          </span>
          <button onClick={exitCompareMode} className="btn-secondary text-xs h-6 px-2 shrink-0">
            <X className="w-3 h-3" /> Exit
          </button>
        </div>
      )}

      {traces.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <Activity className="w-10 h-10 opacity-25" />
          <p className="text-sm">
            {errorsOnly ? 'No traces with errors.' : 'No traces yet — make requests to your Spin app.'}
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* ── Trace list ──────────────────────────────────────── */}
          <div
            className={`overflow-y-auto shrink-0 ${selectedTrace || (compareTraceA && compareTraceB) ? 'border-b border-gray-200' : 'flex-1'}`}
            style={selectedTrace || (compareTraceA && compareTraceB) ? { height: listHeight } : undefined}
          >
            <TraceList
              traces={traces}
              selected={compareMode ? null : selected}
              colorMap={colorMap}
              compFilter={compFilter}
              maxDuration={maxDuration}
              onSelect={handleSelect}
              compareSelection={compareTraces}
            />
          </div>

          {/* ── Resize handle ────────────────────────────────────── */}
          {(selectedTrace || (compareTraceA && compareTraceB)) && (
            <div
              className="h-1.5 shrink-0 cursor-row-resize bg-gray-200 hover:bg-spin-oxfordblue/20 active:bg-spin-oxfordblue/30 transition-colors duration-150 flex items-center justify-center group"
              onMouseDown={e => {
                isDragging.current = true
                dragStartY.current = e.clientY
                dragStartH.current = listHeight
                document.body.style.cursor = 'row-resize'
                e.preventDefault()
              }}
            >
              <div className="w-10 h-0.5 rounded-full bg-gray-300 group-hover:bg-spin-oxfordblue/40 transition-colors duration-150" />
            </div>
          )}

          {/* ── Compare panel ────────────────────────────────────── */}
          {compareMode && compareTraceA && compareTraceB && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                  <GitCompareArrows className="w-4 h-4 text-purple-600 shrink-0" />
                  <span className="text-sm font-semibold text-gray-900">Trace Comparison</span>
                </div>
                <button className="text-gray-400 hover:text-gray-700 text-base px-1" onClick={exitCompareMode}>✕</button>
              </div>
              <TraceComparison traceA={compareTraceA} traceB={compareTraceB} colorMap={colorMap} />
            </div>
          )}

          {/* ── Detail panel ─────────────────────────────────────── */}
          {!compareMode && selectedTrace && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">

              {/* Detail header + tabs */}
              <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Activity className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-semibold text-gray-900 truncate">{selectedTrace.rootName}</span>
                  {selectedTrace.hasErrors && <span className="badge badge-red badge-sm rounded-full shrink-0">ERROR</span>}
                  <span className="text-xs text-gray-400 shrink-0">{selectedTrace.spanCount} spans</span>
                  <div className="hidden lg:flex items-center gap-1 shrink-0">
                    <code className="text-xs text-gray-400 font-mono">{selectedTrace.traceId.slice(0, 16)}…</code>
                    <CopyButton text={selectedTrace.traceId} label="trace ID" />
                  </div>

                  {/* Tabs */}
                  <div className="tab-group ml-2">
                    {([['waterfall', 'Waterfall'], ['logs', 'Related Logs']] as const).map(([tab, label]) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`tab ${activeTab === tab ? 'tab-active' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Open in Logs page */}
                  <button
                    className="btn-secondary text-xs h-7 px-2"
                    onClick={() => openInLogs(selectedTrace)}
                    title="View logs during this trace in the Logs page"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View in Logs
                  </button>
                  <button className="text-gray-400 hover:text-gray-700 text-base px-1" onClick={() => setSelected(null)}>✕</button>
                </div>
              </div>

              {/* Waterfall tab */}
              {activeTab === 'waterfall' && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <Waterfall
                    trace={selectedTrace}
                    colorMap={colorMap}
                    selectedSpanId={selectedSpanId}
                    onSelectSpan={id => setSelectedSpanId(id)}
                  />
                </div>
              )}

              {/* Related logs tab */}
              {activeTab === 'logs' && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 shrink-0">
                    Logs with timestamps between{' '}
                    <strong>{fmtTime(selectedTrace.startMs)}</strong>
                    {' '}and{' '}
                    <strong>{fmtTime(selectedTrace.endMs)}</strong>
                    {' '}(±500ms buffer)
                  </div>
                  <RelatedLogs trace={selectedTrace} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
