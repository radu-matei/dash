import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity, AlertCircle, ChevronDown, ChevronRight,
  ExternalLink, RefreshCw, Search,
} from 'lucide-react'
import { getTraces, getApp, type Span, type AppInfo } from '../api/client'
import { useLogStore } from '../store/logContext'
import { parseLogLine, type ParsedLine } from './LogViewer'

// ─── Color palette ────────────────────────────────────────────────────────────

const PALETTE = [
  '#0284c7', '#7c3aed', '#059669', '#d97706',
  '#0891b2', '#db2777', '#65a30d', '#ea580c',
]

function buildColorMap(spans: Span[]): Map<string, string> {
  const comps = Array.from(new Set(spans.map(s => s.component).filter(Boolean))).sort()
  const m = new Map<string, string>()
  comps.forEach((c, i) => m.set(c!, PALETTE[i % PALETTE.length]))
  return m
}

// ─── Trace grouping ───────────────────────────────────────────────────────────

export interface TraceGroup {
  traceId: string
  rootName: string
  component: string
  startMs: number
  endMs: number
  durationMs: number
  spanCount: number
  hasErrors: boolean
  spans: Span[]
  httpMethod?: string
  httpStatus?: string
}

// Build route→component map from app triggers (e.g. "/agent/..." → "ai-router")
function buildRouteMap(app: AppInfo | null): Map<string, string> {
  const m = new Map<string, string>()
  if (!app) return m
  for (const t of app.triggers) {
    if (t.route && t.component) m.set(t.route, t.component)
  }
  return m
}

function groupTraces(spans: Span[], routeMap: Map<string, string>): TraceGroup[] {
  const map = new Map<string, Span[]>()
  for (const s of spans) {
    const arr = map.get(s.traceId) ?? []; arr.push(s); map.set(s.traceId, arr)
  }
  return Array.from(map.entries()).map(([traceId, ss]) => {
    const sorted = [...ss].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    const root = sorted.find(s => !s.parentId) ?? sorted[0]
    const startMs = new Date(sorted[0].startTime).getTime()
    const endMs = Math.max(...sorted.map(s => new Date(s.startTime).getTime() + s.durationMs))
    const durationMs = Math.max(endMs - startMs, root?.durationMs ?? 0)
    const rootAttrs = root?.attrs ?? {}
    // Spin doesn't set component_id on trace spans (only on metrics).
    // The root HTTP span has http.route which we can map to a component via the app manifest.
    const httpRoute = rootAttrs['http.route']
    const component =
      (httpRoute && routeMap.get(httpRoute)) ??
      sorted.find(s => s.component && s.component !== 'spin')?.component ??
      root?.component ?? ''
    return {
      traceId, rootName: root?.name ?? traceId.slice(0, 8),
      component,
      startMs, endMs: startMs + durationMs, durationMs,
      spanCount: ss.length,
      hasErrors: ss.some(s => s.status === 'ERROR'),
      spans: sorted,
      httpMethod: rootAttrs['http.method'] ?? rootAttrs['http.request.method'],
      httpStatus: rootAttrs['http.response.status_code'] ?? rootAttrs['http.status_code'],
    }
  }).sort((a, b) => b.startMs - a.startMs)
}

// ─── Span tree ────────────────────────────────────────────────────────────────

interface SpanNode { span: Span; children: SpanNode[]; depth: number }

function buildTree(spans: Span[]): SpanNode[] {
  const map = new Map<string, SpanNode>()
  for (const s of spans) map.set(s.spanId, { span: s, children: [], depth: 0 })
  const roots: SpanNode[] = []
  for (const node of map.values()) {
    if (node.span.parentId && map.has(node.span.parentId)) map.get(node.span.parentId)!.children.push(node)
    else roots.push(node)
  }
  const setDepth = (n: SpanNode, d: number) => {
    n.depth = d
    n.children.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime())
    n.children.forEach(c => setDepth(c, d + 1))
  }
  roots.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime())
  roots.forEach(r => setDepth(r, 0))
  return roots
}

function flattenTree(nodes: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = []
  const visit = (n: SpanNode) => { out.push(n); n.children.forEach(visit) }
  nodes.forEach(visit)
  return out
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    // @ts-expect-error valid
    fractionalSecondDigits: 3,
  })
}

// ─── Span attributes panel ────────────────────────────────────────────────────

// Well-known OTel attrs to highlight prominently
const KEY_ATTRS = ['http.method','http.url','http.route','http.status_code','rpc.method','db.statement','error.message','exception.message','exception.type']

function SpanDetail({ node, colorMap, onClose }: { node: SpanNode; colorMap: Map<string, string>; onClose: () => void }) {
  const { span } = node
  const isError = span.status === 'ERROR'
  const color = colorMap.get(span.component ?? '') ?? '#6b7280'
  const attrs = span.attrs ?? {}
  const keyAttrs = KEY_ATTRS.filter(k => attrs[k])
  const otherAttrs = Object.entries(attrs).filter(([k]) => !KEY_ATTRS.includes(k))
  const httpStatus = attrs['http.response.status_code'] ?? attrs['http.status_code']
  const isStatusError = httpStatus && Number(httpStatus) >= 400

  return (
    <div className="border-t border-gray-200 bg-white text-xs flex flex-col max-h-72 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isError ? '#dc2626' : color }} />
          <span className="font-semibold text-gray-900 font-mono truncate">{span.name}</span>
          {isError && <span className="badge badge-red shrink-0">ERROR</span>}
          {httpStatus && (
            <span className={`badge shrink-0 font-mono ${isStatusError ? 'badge-red' : 'badge-gray'}`}>
              HTTP {httpStatus}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-b border-gray-100 text-gray-500">
        <span>Start: <strong className="text-gray-900">{fmtTime(new Date(span.startTime).getTime())}</strong></span>
        <span>Duration: <strong className="text-gray-900">{fmtDuration(span.durationMs)}</strong></span>
        {span.component && <span>Component: <strong className="text-gray-900">{span.component}</strong></span>}
        <span className="font-mono text-gray-400">span: {span.spanId.slice(0, 16)}…</span>
        {span.parentId && <span className="font-mono text-gray-400">parent: {span.parentId.slice(0, 16)}…</span>}
      </div>

      {/* Key attrs */}
      {keyAttrs.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 grid grid-cols-[minmax(160px,auto)_1fr] gap-x-4 gap-y-1">
          {keyAttrs.map(k => (
            <>
              <span key={k + 'k'} className="text-gray-500 font-mono whitespace-nowrap">{k}</span>
              <span key={k + 'v'} className={`font-mono break-all ${
                (k === 'http.status_code' || k === 'http.response.status_code') && Number(attrs[k]) >= 400
                  ? 'text-red-700 font-semibold'
                  : 'text-gray-800'
              }`}>{attrs[k]}</span>
            </>
          ))}
        </div>
      )}

      {/* All other attrs — shown by default, no collapsible */}
      {otherAttrs.length > 0 && (
        <div className="px-4 py-2 grid grid-cols-[minmax(160px,auto)_1fr] gap-x-4 gap-y-1">
          {otherAttrs.map(([k, v]) => (
            <>
              <span key={k + 'k'} className="text-gray-400 font-mono whitespace-nowrap">{k}</span>
              <span key={k + 'v'} className="font-mono break-all text-gray-700">{v}</span>
            </>
          ))}
        </div>
      )}

      {Object.keys(attrs).length === 0 && (
        <p className="px-4 py-3 text-gray-400 italic">No attributes recorded for this span.</p>
      )}
    </div>
  )
}

// ─── Waterfall ────────────────────────────────────────────────────────────────

function Waterfall({
  trace, colorMap, selectedSpanId, onSelectSpan,
}: {
  trace: TraceGroup
  colorMap: Map<string, string>
  selectedSpanId: string | null
  onSelectSpan: (id: string | null) => void
}) {
  const flat = useMemo(() => flattenTree(buildTree(trace.spans)), [trace.spans])
  const startMs = trace.startMs
  const durMs = trace.durationMs || 1
  const maxDepth = Math.max(...flat.map(n => n.depth), 0)
  const components = Array.from(new Set(trace.spans.map(s => s.component).filter(Boolean)))

  return (
    <div className="text-xs flex-1 overflow-y-auto">
      {/* Stats + legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-gray-500 shrink-0">
        <span>Started: <strong className="text-gray-900">{fmtTime(trace.startMs)}</strong></span>
        <span>Duration: <strong className="text-gray-900">{fmtDuration(trace.durationMs)}</strong></span>
        <span>Depth: <strong className="text-gray-900">{maxDepth + 1}</strong></span>
        <span>Spans: <strong className="text-gray-900">{trace.spanCount}</strong></span>
        {components.length > 0 && (
          <div className="ml-auto flex items-center gap-4">
            {components.map(c => (
              <div key={c} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorMap.get(c!) }} />
                <span className="text-gray-600">{c}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="flex border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 shrink-0">
        <div className="w-72 shrink-0 px-4 py-2">Span</div>
        <div className="w-16 shrink-0 px-2 py-2 text-right">Duration</div>
        <div className="flex-1 py-2 pr-4 relative">
          <div className="flex justify-between text-gray-400 font-mono font-normal normal-case tracking-normal">
            {[0, 25, 50, 75, 100].map(p => <span key={p}>{p === 0 ? '0' : fmtDuration(Math.round(durMs * p / 100))}</span>)}
          </div>
        </div>
      </div>

      {/* Rows */}
      {flat.map(node => {
        const spanStartMs = new Date(node.span.startTime).getTime()
        const leftPct = Math.max(0, ((spanStartMs - startMs) / durMs) * 100)
        const widthPct = Math.max(0.5, (node.span.durationMs / durMs) * 100)
        const color = colorMap.get(node.span.component ?? '') ?? '#6b7280'
        const isError = node.span.status === 'ERROR'
        const isSelected = node.span.spanId === selectedSpanId
        const hasAttrs = Object.keys(node.span.attrs ?? {}).length > 0

        return (
          <div
            key={node.span.spanId}
            onClick={() => onSelectSpan(isSelected ? null : node.span.spanId)}
            className={`flex items-center border-b border-gray-100 cursor-pointer transition-colors ${
              isSelected ? 'bg-blue-50' : isError ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50'
            }`}
          >
            {/* Name */}
            <div className="w-72 shrink-0 flex items-center gap-1.5 py-2 pr-2" style={{ paddingLeft: `${12 + node.depth * 14}px` }}>
              {hasAttrs
                ? (isSelected ? <ChevronDown className="w-3 h-3 text-blue-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />)
                : <span className="w-3 shrink-0" />
              }
              {isError
                ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                : <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                    title={node.span.component ?? undefined}
                  />
              }
              <span className={`truncate font-mono ${isError ? 'text-red-700' : 'text-gray-800'}`} title={node.span.name}>
                {node.span.name}
              </span>
              {node.span.component && components.length > 1 && (
                <span className="ml-auto shrink-0 text-[10px] font-mono px-1 py-px rounded" style={{ color, opacity: 0.8 }}>
                  {node.span.component}
                </span>
              )}
            </div>

            {/* Duration */}
            <div className="w-16 shrink-0 text-right px-2 py-2 font-mono text-gray-500">{fmtDuration(node.span.durationMs)}</div>

            {/* Bar */}
            <div className="flex-1 relative pr-4 h-8">
              <div className="absolute inset-y-1.5 left-0 right-4">
                {[25, 50, 75].map(p => (
                  <div key={p} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: `${p}%` }} />
                ))}
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-sm transition-opacity"
                  style={{
                    left: `${Math.min(leftPct, 99.5)}%`,
                    width: `${Math.min(widthPct, 100 - leftPct)}%`,
                    backgroundColor: isError ? '#dc2626' : color,
                    opacity: 0.85, minWidth: 3,
                  }}
                  title={`${node.span.name} — ${fmtDuration(node.span.durationMs)}`}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Related logs panel ───────────────────────────────────────────────────────

function RelatedLogs({ trace }: { trace: TraceGroup }) {
  const { rawLines } = useLogStore()

  // Parse only lines that might have timestamps (skip if no log store data)
  const related = useMemo<ParsedLine[]>(() => {
    const BUFFER_MS = 500 // catch logs slightly outside the trace window
    return rawLines
      .map(parseLogLine)
      .filter(l => {
        if (l.timestampMs === null) return false
        return l.timestampMs >= trace.startMs - BUFFER_MS &&
               l.timestampMs <= trace.endMs + BUFFER_MS
      })
  }, [rawLines, trace.startMs, trace.endMs])

  if (related.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2 text-xs">
        <p>No timestamped log lines found during this trace window.</p>
        <p className="text-gray-300">
          {fmtTime(trace.startMs)} → {fmtTime(trace.endMs)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto font-mono text-xs">
      {related.map(l => (
        <div
          key={l.id}
          className={`flex items-start px-4 py-0.5 border-b border-gray-50 leading-5 ${
            l.level === 'ERROR' ? 'bg-red-50/50' :
            l.level === 'WARN'  ? 'bg-amber-50/30' : ''
          }`}
        >
          <span className="w-24 shrink-0 text-gray-400 tabular-nums">{l.timestamp}</span>
          <span className="w-20 shrink-0 text-gray-400 truncate">{l.source?.split('::').pop() ?? l.raw.stream}</span>
          <span className={`flex-1 break-all ${
            l.level === 'ERROR' ? 'text-red-700' :
            l.level === 'WARN'  ? 'text-amber-800' :
            l.level === 'TRACE' ? 'text-gray-400' : 'text-gray-700'
          }`}>
            {l.message}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Trace list sub-components ────────────────────────────────────────────────

function SpanDots({ trace, colorMap }: { trace: TraceGroup; colorMap: Map<string, string> }) {
  const comps = Array.from(new Set(trace.spans.map(s => s.component).filter(Boolean)))
  return (
    <div className="flex items-center gap-1.5">
      {comps.slice(0, 5).map(c => (
        <div key={c} className="w-2 h-2 rounded-full" style={{ backgroundColor: colorMap.get(c!) }} title={c!} />
      ))}
      {comps.length > 5 && <span className="text-xs text-gray-400">+{comps.length - 5}</span>}
      <span className="text-xs text-gray-500 ml-0.5">{trace.spanCount}</span>
    </div>
  )
}

function DurationBar({ durationMs, maxDurationMs }: { durationMs: number; maxDurationMs: number }) {
  const pct = maxDurationMs > 0 ? (durationMs / maxDurationMs) * 100 : 100
  return (
    <div className="flex items-center gap-2 pr-4">
      <span className="text-xs font-mono text-gray-700 w-14 text-right shrink-0">{fmtDuration(durationMs)}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TraceViewer() {
  const [searchParams] = useSearchParams()
  const [allSpans, setAllSpans]   = useState<Span[]>([])
  const [appInfo, setAppInfo]     = useState<AppInfo | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [selected, setSelected]   = useState<string | null>(null)
  const [filter, setFilter]       = useState('')
  const [errorsOnly, setErrorsOnly] = useState(() => searchParams.get('errors') === '1')
  const [activeTab, setActiveTab] = useState<'waterfall' | 'logs'>('waterfall')
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const navigate = useNavigate()

  // Fetch app manifest once to build the route→component map.
  useEffect(() => {
    getApp().then(setAppInfo).catch(() => {})
  }, [])

  // Ref that the refresh button can call to skip the current sleep and fetch immediately.
  const wakeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Sequential polling: wait for each response to arrive before sleeping for
    // the next tick.  setInterval would abort the previous in-flight request
    // every 3 s, causing perpetual cancellations when the payload is large.
    const ctrl = new AbortController()
    let active = true

    const run = async () => {
      while (active) {
        try {
          setAllSpans((await getTraces(ctrl.signal)) ?? [])
          setError(null)
        } catch (e: unknown) {
          if ((e as Error).name === 'AbortError') break
          setError((e as Error).message)
        }
        // Sleep 3 s, but allow early wake via wakeRef (refresh button).
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

  const routeMap = useMemo(() => buildRouteMap(appInfo), [appInfo])
  const colorMap = useMemo(() => buildColorMap(allSpans), [allSpans])

  const traces = useMemo(() => {
    let all = groupTraces(allSpans, routeMap)
    if (errorsOnly) all = all.filter(t => t.hasErrors)
    if (!filter) return all
    const q = filter.toLowerCase()
    return all.filter(t =>
      t.rootName.toLowerCase().includes(q) ||
      t.component.toLowerCase().includes(q) ||
      t.traceId.includes(q)
    )
  }, [allSpans, filter, errorsOnly])

  const selectedTrace = useMemo(() => traces.find(t => t.traceId === selected) ?? null, [traces, selected])
  const maxDuration   = useMemo(() => Math.max(...traces.map(t => t.durationMs), 1), [traces])
  const errorCount    = traces.filter(t => t.hasErrors).length

  // When selected span changes, clear if the new selected trace doesn't include it
  const selectedSpanNode = useMemo(() => {
    if (!selectedTrace || !selectedSpanId) return null
    const flat = flattenTree(buildTree(selectedTrace.spans))
    return flat.find(n => n.span.spanId === selectedSpanId) ?? null
  }, [selectedTrace, selectedSpanId])

  const openInLogs = (trace: TraceGroup) => {
    const params = new URLSearchParams({
      from: String(trace.startMs - 500),
      to:   String(trace.endMs + 500),
      label: trace.rootName,
    })
    navigate(`/logs?${params}`)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Traces</h1>
          {traces.length > 0 && (
            <>
              <span className="badge badge-gray">{traces.length}</span>
              {errorCount > 0 && <span className="badge badge-red">{errorCount} with errors</span>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Errors only */}
          <button
            onClick={() => setErrorsOnly(v => !v)}
            className={`btn text-xs h-8 px-2.5 ${errorsOnly ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200' : 'btn-secondary'}`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Errors only
            {errorsOnly && <span className="ml-1 font-semibold">✓</span>}
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input text-xs py-1 pl-8 h-8 w-56"
              placeholder="Filter by name, component…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <button className="btn-secondary text-xs h-8 px-2.5" onClick={() => wakeRef.current?.()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
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
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* ── Trace list ──────────────────────────────────────── */}
          <div className={`overflow-y-auto shrink-0 ${selectedTrace ? 'max-h-48 border-b border-gray-200' : 'flex-1'}`}>
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-50/95 z-10 border-b border-gray-200">
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 w-28">Timestamp</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5 w-32">Spans</th>
                  <th className="text-left px-4 py-2.5 w-52">Duration</th>
                </tr>
              </thead>
              <tbody>
                {traces.map(t => (
                  <tr
                    key={t.traceId}
                    onClick={() => {
                      setSelected(t.traceId === selected ? null : t.traceId)
                      setSelectedSpanId(null)
                      setActiveTab('waterfall')
                    }}
                    className={`border-b border-gray-100 cursor-pointer transition-colors group ${
                      t.traceId === selected
                        ? 'bg-blue-50 border-l-2 border-l-blue-500'
                        : t.hasErrors ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-gray-500 tabular-nums">{fmtTime(t.startMs)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.hasErrors && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                        {t.httpMethod && (
                          <span className="badge badge-gray font-mono text-xs px-1.5 py-0.5">{t.httpMethod}</span>
                        )}
                        <span className="font-semibold text-gray-900">{t.rootName}</span>
                        {t.component && (() => {
                          const color = colorMap.get(t.component) ?? '#9ca3af'
                          return (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-mono border"
                              style={{ borderColor: color, color, backgroundColor: `${color}18` }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              {t.component}
                            </span>
                          )
                        })()}
                        {t.httpStatus && (
                          <span className={`badge text-xs px-1.5 py-0.5 font-mono ${
                            Number(t.httpStatus) >= 500 ? 'badge-red' :
                            Number(t.httpStatus) >= 400 ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            'badge-gray'
                          }`}>{t.httpStatus}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><SpanDots trace={t} colorMap={colorMap} /></td>
                    <td className="py-2.5"><DurationBar durationMs={t.durationMs} maxDurationMs={maxDuration} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Detail panel ─────────────────────────────────────── */}
          {selectedTrace && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">

              {/* Detail header + tabs */}
              <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-semibold text-gray-900">{selectedTrace.rootName}</span>
                  <code className="text-xs text-gray-400 font-mono hidden lg:block">{selectedTrace.traceId}</code>

                  {/* Tabs */}
                  <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium ml-2">
                    {([['waterfall', 'Waterfall'], ['logs', 'Related Logs']] as const).map(([tab, label]) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 transition-colors ${activeTab === tab ? 'bg-spin-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
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
                  {/* Span detail drawer */}
                  {selectedSpanNode && (
                    <SpanDetail
                      node={selectedSpanNode}
                      colorMap={colorMap}
                      onClose={() => setSelectedSpanId(null)}
                    />
                  )}
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
