import { AlertCircle } from 'lucide-react'
import type { TraceGroup } from './types'
import { fmtTime, fmtDuration } from './traceUtils'

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

export default function TraceList({
  traces, selected, colorMap, compFilter, maxDuration,
  onSelect, compareSelection,
}: {
  traces: TraceGroup[]
  selected: string | null
  colorMap: Map<string, string>
  compFilter: string
  maxDuration: number
  onSelect: (traceId: string | null) => void
  compareSelection?: [string, string] | null
}) {
  return (
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
        {traces.map(t => {
          const isCompareA = compareSelection?.[0] === t.traceId
          const isCompareB = compareSelection?.[1] === t.traceId
          const isCompared = isCompareA || isCompareB
          return (
          <tr
            key={t.traceId}
            onClick={() => onSelect(t.traceId === selected ? null : t.traceId)}
            className={`border-b border-gray-100 cursor-pointer transition-colors group ${
              isCompared
                ? 'bg-purple-50 border-l-2 border-l-purple-500'
                : t.traceId === selected
                ? 'bg-blue-50 border-l-2 border-l-blue-500'
                : t.hasErrors ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-gray-50'
            }`}
          >
            <td className="px-4 py-2.5 font-mono text-gray-500 tabular-nums">
              <div className="flex items-center gap-1.5">
                {isCompareA && <span className="badge badge-purple text-[10px] px-1 py-0">A</span>}
                {isCompareB && <span className="badge badge-purple text-[10px] px-1 py-0">B</span>}
                {fmtTime(t.startMs)}
              </div>
            </td>
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                {t.hasErrors && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                {t.httpMethod && (
                  <span className="badge badge-gray font-mono text-xs px-1.5 py-0.5">{t.httpMethod}</span>
                )}
                <span className="font-semibold text-gray-900">{t.rootName}</span>
                {t.component && (() => {
                  const color = colorMap.get(t.component) ?? '#9ca3af'
                  const isDownstream = compFilter !== 'all' && t.component !== compFilter
                  return (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-mono border"
                      style={{ borderColor: color, color, backgroundColor: `${color}18` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      {isDownstream ? <>via {t.component}</> : t.component}
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
        )})}
      </tbody>
    </table>
  )
}
