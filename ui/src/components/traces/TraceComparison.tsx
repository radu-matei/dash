import { useMemo } from 'react'
import type { TraceGroup } from './types'
import type { SpanNode } from './types'
import { buildTree, flattenTree, fmtDuration, fmtTime, EXEC_WASM_PREFIX, spanComponent } from './traceUtils'
import { AlertCircle, Cpu } from 'lucide-react'

interface MatchedRow {
  nameA: string
  nameB: string
  durationA: number
  durationB: number
  delta: number
  depth: number
  isError: boolean
  component?: string
}

function matchSpanTrees(treeA: SpanNode[], treeB: SpanNode[]): MatchedRow[] {
  const rows: MatchedRow[] = []

  const flatA = flattenTree(treeA)
  const flatB = flattenTree(treeB)

  // Build name→span lookup for B at each depth
  const bByNameDepth = new Map<string, SpanNode>()
  for (const n of flatB) {
    bByNameDepth.set(`${n.depth}:${n.span.name}`, n)
  }

  for (const nodeA of flatA) {
    const key = `${nodeA.depth}:${nodeA.span.name}`
    const nodeB = bByNameDepth.get(key)
    const durA = nodeA.span.durationMs
    const durB = nodeB?.span.durationMs ?? 0
    rows.push({
      nameA: nodeA.span.name,
      nameB: nodeB?.span.name ?? '—',
      durationA: durA,
      durationB: durB,
      delta: durB - durA,
      depth: nodeA.depth,
      isError: nodeA.span.status === 'ERROR' || nodeB?.span.status === 'ERROR',
      component: spanComponent(nodeA.span) || undefined,
    })
    bByNameDepth.delete(key) // consume match
  }

  // Add unmatched B spans
  for (const [, nodeB] of bByNameDepth) {
    rows.push({
      nameA: '—',
      nameB: nodeB.span.name,
      durationA: 0,
      durationB: nodeB.span.durationMs,
      delta: nodeB.span.durationMs,
      depth: nodeB.depth,
      isError: nodeB.span.status === 'ERROR',
      component: spanComponent(nodeB.span) || undefined,
    })
  }

  return rows
}

function deltaColor(delta: number): string {
  if (delta < -1) return 'text-green-600'
  if (delta > 1) return 'text-red-600'
  return 'text-gray-400'
}

function deltaText(delta: number): string {
  if (Math.abs(delta) < 1) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${fmtDuration(delta)}`
}

export default function TraceComparison({
  traceA, traceB, colorMap,
}: {
  traceA: TraceGroup
  traceB: TraceGroup
  colorMap: Map<string, string>
}) {
  const treeA = useMemo(() => buildTree(traceA.spans), [traceA.spans])
  const treeB = useMemo(() => buildTree(traceB.spans), [traceB.spans])
  const rows = useMemo(() => matchSpanTrees(treeA, treeB), [treeA, treeB])

  const totalDelta = traceB.durationMs - traceA.durationMs

  return (
    <div className="flex-1 flex flex-col overflow-hidden text-xs">
      {/* Summary bar */}
      <div className="flex items-center gap-6 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-gray-500 shrink-0">
        <span>Trace A: <strong className="text-gray-900">{fmtDuration(traceA.durationMs)}</strong> <span className="text-gray-400 font-mono">({fmtTime(traceA.startMs)})</span></span>
        <span>Trace B: <strong className="text-gray-900">{fmtDuration(traceB.durationMs)}</strong> <span className="text-gray-400 font-mono">({fmtTime(traceB.startMs)})</span></span>
        <span>Delta: <strong className={deltaColor(totalDelta)}>{deltaText(totalDelta)}</strong></span>
        <span>Spans: <strong className="text-gray-900">{traceA.spanCount}</strong> vs <strong className="text-gray-900">{traceB.spanCount}</strong></span>
      </div>

      {/* Column headers */}
      <div className="flex border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 shrink-0">
        <div className="flex-1 px-4 py-2">Span</div>
        <div className="w-24 px-2 py-2 text-right">Trace A</div>
        <div className="w-24 px-2 py-2 text-right">Trace B</div>
        <div className="w-24 px-2 py-2 text-right">Delta</div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.map((row, i) => {
          const color = row.component ? (colorMap.get(row.component) ?? '#6b7280') : '#6b7280'
          const name = row.nameA !== '—' ? row.nameA : row.nameB
          const isExec = name.startsWith(EXEC_WASM_PREFIX)
          const displayName = isExec ? name.slice(EXEC_WASM_PREFIX.length) : name
          const isMissing = row.nameA === '—' || row.nameB === '—'

          return (
            <div
              key={i}
              className={`flex items-center border-b border-gray-100 ${
                isMissing ? 'bg-gray-50/50 opacity-60' : row.isError ? 'bg-red-50/30' : ''
              }`}
            >
              <div className="flex-1 flex items-center gap-1.5 py-1.5 pr-2 overflow-hidden" style={{ paddingLeft: `${12 + row.depth * 14}px` }}>
                {row.isError
                  ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                  : <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                }
                {isExec ? (
                  <>
                    <Cpu className="w-3 h-3 shrink-0" style={{ color }} />
                    <span className="font-semibold truncate" style={{ color }}>{displayName}</span>
                  </>
                ) : (
                  <span className="font-mono truncate text-gray-800">{displayName}</span>
                )}
                {isMissing && (
                  <span className="shrink-0 text-[10px] font-mono px-1 py-px rounded bg-gray-100 text-gray-500">
                    {row.nameA === '—' ? 'only in B' : 'only in A'}
                  </span>
                )}
              </div>
              <div className="w-24 text-right px-2 py-1.5 font-mono text-gray-500">
                {row.durationA > 0 ? fmtDuration(row.durationA) : '—'}
              </div>
              <div className="w-24 text-right px-2 py-1.5 font-mono text-gray-500">
                {row.durationB > 0 ? fmtDuration(row.durationB) : '—'}
              </div>
              <div className={`w-24 text-right px-2 py-1.5 font-mono font-semibold ${deltaColor(row.delta)}`}>
                {deltaText(row.delta)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
