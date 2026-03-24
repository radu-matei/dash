import { useMemo } from 'react'
import type { TraceGroup } from './types'
import { fmtTime } from './traceUtils'
import { useLogStore } from '../../store/logContext'
import { parseLogLine, type ParsedLine } from '../LogViewer'

export default function RelatedLogs({ trace }: { trace: TraceGroup }) {
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
