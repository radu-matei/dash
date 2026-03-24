import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Cpu, Search, X } from 'lucide-react'
import type { TraceGroup } from './types'
import type { SpanNode } from './types'
import { buildTree, flattenTree, spanComponent, descendantCount, fmtDuration, fmtTime, EXEC_WASM_PREFIX } from './traceUtils'
import SpanDetail from './SpanDetail'

// ─── Tree line annotations ───────────────────────────────────────────────────

interface FlatNode {
  node: SpanNode
  /** For each depth 0..depth-1, whether a vertical connector line should continue. */
  continues: boolean[]
  /** Whether this is the last child of its parent. */
  isLast: boolean
}

function annotateFlatNodes(nodes: SpanNode[], collapsed: Set<string>): FlatNode[] {
  const out: FlatNode[] = []

  const visit = (n: SpanNode, continues: boolean[], isLast: boolean) => {
    out.push({ node: n, continues: [...continues], isLast })
    if (collapsed.has(n.span.spanId)) return
    const kids = n.children
    kids.forEach((child, i) => {
      const childIsLast = i === kids.length - 1
      visit(child, [...continues, !childIsLast], childIsLast)
    })
  }

  nodes.forEach((root, i) => {
    visit(root, [], i === nodes.length - 1)
  })

  return out
}

// ─── Waterfall component ─────────────────────────────────────────────────────

export default function Waterfall({
  trace, colorMap, selectedSpanId, onSelectSpan,
}: {
  trace: TraceGroup
  colorMap: Map<string, string>
  selectedSpanId: string | null
  onSelectSpan: (id: string | null) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [spanSearch, setSpanSearch] = useState('')
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const tree = useMemo(() => buildTree(trace.spans), [trace.spans])

  // Full flat list (ignoring collapse) for color computation.
  const allFlat = useMemo(() => flattenTree(tree), [tree])

  // Span search: find matching spanIds across all spans (not just visible ones).
  const spanMatchIds = useMemo(() => {
    if (!spanSearch) return new Set<string>()
    const q = spanSearch.toLowerCase()
    const ids = new Set<string>()
    for (const n of allFlat) {
      const s = n.span
      if (
        s.name?.toLowerCase().includes(q) ||
        s.component?.toLowerCase().includes(q) ||
        Object.entries(s.attrs ?? {}).some(([k, v]) =>
          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
        )
      ) {
        ids.add(s.spanId)
      }
    }
    return ids
  }, [allFlat, spanSearch])

  // Auto-expand parents of matching spans when searching.
  const effectiveCollapsed = useMemo(() => {
    if (!spanSearch || spanMatchIds.size === 0) return collapsed
    // Find all ancestor spanIds of matching spans and remove them from collapsed set.
    const parentMap = new Map<string, string>()
    for (const s of trace.spans) { if (s.parentId) parentMap.set(s.spanId, s.parentId) }
    const toExpand = new Set<string>()
    for (const id of spanMatchIds) {
      let pid = parentMap.get(id)
      while (pid) { toExpand.add(pid); pid = parentMap.get(pid) }
    }
    const next = new Set(collapsed)
    for (const id of toExpand) next.delete(id)
    return next
  }, [collapsed, spanSearch, spanMatchIds, trace.spans])

  // Annotated flat list respecting collapse state.
  const annotated = useMemo(() => annotateFlatNodes(tree, effectiveCollapsed), [tree, effectiveCollapsed])

  // Reset collapse state when switching traces.
  const traceIdRef = useMemo(() => trace.traceId, [trace.traceId])
  useMemo(() => { setCollapsed(new Set()) }, [traceIdRef])

  // Map each span to its effective component by inheriting from the nearest
  // ancestor execute_wasm_component span (like Jaeger inherits service color).
  const spanColorComponent = useMemo(() => {
    const m = new Map<string, string>()
    const parentMap = new Map<string, string>()
    for (const s of trace.spans) parentMap.set(s.spanId, s.parentId ?? '')
    for (const node of allFlat) {
      const sc = spanComponent(node.span)
      if (sc && sc !== 'spin') { m.set(node.span.spanId, sc); continue }
      let pid = node.span.parentId
      while (pid && parentMap.has(pid)) {
        if (m.has(pid)) { m.set(node.span.spanId, m.get(pid)!); break }
        pid = parentMap.get(pid) || undefined
      }
    }
    return m
  }, [allFlat, trace.spans])

  // Collect all parent spanIds (spans with children) for collapse/expand all.
  const parentIds = useMemo(() => {
    const s = new Set<string>()
    for (const n of allFlat) { if (n.children.length > 0) s.add(n.span.spanId) }
    return s
  }, [allFlat])

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(spanId)) next.delete(spanId)
      else next.add(spanId)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => setCollapsed(new Set(parentIds)), [parentIds])
  const expandAll = useCallback(() => setCollapsed(new Set()), [])

  // Ordered list of match spanIds (for cycling through matches).
  const orderedMatches = useMemo(() => {
    if (!spanSearch) return [] as string[]
    return annotated.filter(a => spanMatchIds.has(a.node.span.spanId)).map(a => a.node.span.spanId)
  }, [annotated, spanMatchIds, spanSearch])

  const cycleMatch = useCallback((dir: 1 | -1) => {
    if (orderedMatches.length === 0) return
    setActiveMatchIdx(prev => {
      const next = (prev + dir + orderedMatches.length) % orderedMatches.length
      const spanId = orderedMatches[next]
      if (spanId) {
        const el = rowRefs.current.get(spanId)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      return next
    })
  }, [orderedMatches])

  // Reset active match index when search changes.
  useMemo(() => setActiveMatchIdx(0), [spanSearch])

  const startMs = trace.startMs
  const durMs = trace.durationMs || 1
  const maxDepth = Math.max(...allFlat.map(n => n.depth), 0)
  const components = Array.from(trace.components)
  const INDENT_PX = 14

  return (
    <div className="text-xs flex-1 flex flex-col overflow-hidden">
      {/* Stats + legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-gray-500 shrink-0">
        <span>Started: <strong className="text-gray-900">{fmtTime(trace.startMs)}</strong></span>
        <span>Duration: <strong className="text-gray-900">{fmtDuration(trace.durationMs)}</strong></span>
        <span>Depth: <strong className="text-gray-900">{maxDepth + 1}</strong></span>
        <span>Spans: <strong className="text-gray-900">{trace.spanCount}</strong></span>

        {/* Collapse / Expand all */}
        {parentIds.size > 0 && (
          <div className="flex items-center gap-1">
            <button onClick={collapseAll} className="btn-secondary text-xs h-6 px-1.5" title="Collapse all">
              <ChevronsDownUp className="w-3 h-3" />
            </button>
            <button onClick={expandAll} className="btn-secondary text-xs h-6 px-1.5" title="Expand all">
              <ChevronsUpDown className="w-3 h-3" />
            </button>
          </div>
        )}


        {/* Span search */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input text-xs py-0.5 pl-7 pr-6 h-6 w-36"
              placeholder="Find span…"
              value={spanSearch}
              onChange={e => setSpanSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); cycleMatch(e.shiftKey ? -1 : 1) }
                if (e.key === 'Escape') { setSpanSearch('') }
              }}
            />
            {spanSearch && (
              <button onClick={() => setSpanSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {spanSearch && (
            <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
              {orderedMatches.length > 0
                ? <>{activeMatchIdx + 1} of {orderedMatches.length}</>
                : 'No matches'
              }
            </span>
          )}
        </div>

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
        <div className="flex-1 py-2 pl-4 pr-4 relative">
          <div className="flex justify-between text-gray-400 font-mono font-normal normal-case tracking-normal">
            {[0, 25, 50, 75, 100].map(p => (
              <span key={p} className="flex flex-col items-center gap-0.5">
                <span>{p === 0 ? '0' : fmtDuration(Math.round(durMs * p / 100))}</span>
                <span className="w-px h-1.5 bg-gray-300" />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Rows (scrollable) */}
      <div className="flex-1 overflow-y-auto">
      {annotated.map(({ node, continues }) => {
        const spanStartMs = new Date(node.span.startTime).getTime()
        const leftPct = Math.max(0, ((spanStartMs - startMs) / durMs) * 100)
        const widthPct = Math.max(0.5, (node.span.durationMs / durMs) * 100)
        const effectiveComp = spanColorComponent.get(node.span.spanId)
        const color = (effectiveComp && colorMap.get(effectiveComp)) ?? colorMap.get(node.span.component ?? '') ?? '#6b7280'
        const isError = node.span.status === 'ERROR'
        const isSelected = node.span.spanId === selectedSpanId
        const hasChildren = node.children.length > 0
        const isCollapsed = effectiveCollapsed.has(node.span.spanId)
        const hiddenCount = isCollapsed ? descendantCount(node) : 0
        const isMatch = spanSearch && spanMatchIds.has(node.span.spanId)
        const isActiveMatch = isMatch && orderedMatches[activeMatchIdx] === node.span.spanId
        const isDimmed = spanSearch && !isMatch

        return (
          <div key={node.span.spanId} className="flex flex-col" ref={el => { if (el) rowRefs.current.set(node.span.spanId, el); else rowRefs.current.delete(node.span.spanId) }}>
          <div
            onClick={() => onSelectSpan(isSelected ? null : node.span.spanId)}
            className={[
              'flex items-center border-b border-gray-100 cursor-pointer transition-colors',
              isActiveMatch ? 'bg-yellow-100 ring-1 ring-inset ring-yellow-400'
              : isMatch ? 'bg-yellow-50'
              : isSelected ? 'bg-blue-50'
              : isError ? 'bg-red-50/40 hover:bg-red-50/70'
              : 'hover:bg-gray-50',
              isDimmed ? 'opacity-40' : '',
            ].join(' ')}
          >
            {/* Name with tree connectors */}
            <div className="w-72 shrink-0 flex items-center gap-1.5 py-2 pr-2 overflow-hidden relative" style={{ paddingLeft: `${12 + node.depth * INDENT_PX}px` }}>
              {/* Tree connector lines: vertical lines for ancestor depths that have more siblings */}
              {continues.map((cont, i) => {
                if (i === node.depth - 1) {
                  // Current depth: draw an L-shape (vertical from top to center + horizontal stub)
                  return (
                    <div key={i}>
                      <div className="absolute w-px bg-gray-200" style={{ left: `${12 + i * INDENT_PX + 5}px`, top: 0, height: '50%' }} />
                      {cont && <div className="absolute w-px bg-gray-200" style={{ left: `${12 + i * INDENT_PX + 5}px`, top: '50%', bottom: 0 }} />}
                      <div className="absolute h-px bg-gray-200" style={{ left: `${12 + i * INDENT_PX + 5}px`, top: '50%', width: `${INDENT_PX - 5}px` }} />
                    </div>
                  )
                }
                // Ancestor depth: only draw vertical line if there are more siblings below at that depth
                if (!cont) return null
                return <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: `${12 + i * INDENT_PX + 5}px` }} />
              })}

              {/* Collapse/expand chevron for parent spans, detail chevron for leaf spans */}
              {hasChildren ? (
                <button
                  onClick={e => { e.stopPropagation(); toggleCollapse(node.span.spanId) }}
                  className="shrink-0 text-gray-400 hover:text-gray-600"
                >
                  {isCollapsed
                    ? <ChevronRight className="w-3 h-3" />
                    : <ChevronDown className="w-3 h-3" />
                  }
                </button>
              ) : (
                isSelected ? <ChevronDown className="w-3 h-3 text-blue-500 shrink-0" />
                : Object.keys(node.span.attrs ?? {}).length > 0
                  ? <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />
                  : <span className="w-3 shrink-0" />
              )}
              {isError
                ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                : <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                    title={node.span.component ?? undefined}
                  />
              }
              {node.span.name?.startsWith(EXEC_WASM_PREFIX) ? (<>
                  <Cpu className="w-3 h-3 shrink-0" style={{ color }} />
                  <span className={`font-semibold truncate min-w-0 ${isError ? 'text-red-700' : ''}`} style={isError ? undefined : { color }} title={node.span.name}>{node.span.name.slice(EXEC_WASM_PREFIX.length)}</span>
              </>) : (
                <span className={`truncate min-w-0 font-mono ${isError ? 'text-red-700' : 'text-gray-800'}`} title={node.span.name}>
                  {node.span.name}
                </span>
              )}
              {isCollapsed && hiddenCount > 0 && (
                <span className="shrink-0 text-[10px] font-mono px-1 py-px rounded bg-gray-100 text-gray-500">
                  +{hiddenCount}
                </span>
              )}
              {effectiveComp && components.length > 1 && !node.span.name?.startsWith(EXEC_WASM_PREFIX) && (
                <span className="ml-auto shrink-0 text-[10px] font-mono px-1 py-px rounded" style={{ color, opacity: 0.8 }}>
                  {effectiveComp}
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
          {isSelected && (
            <SpanDetail node={node} colorMap={colorMap} effectiveColor={color} effectiveComponent={effectiveComp} onClose={() => onSelectSpan(null)} />
          )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
