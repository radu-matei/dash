import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, Clock, Search, Trash2, X } from 'lucide-react'
import { useLogStore } from '../store/logContext'
import type { LogLine } from '../api/client'

// ─── ANSI stripping ───────────────────────────────────────────────────────────

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g
const strip = (s: string) => s.replace(ANSI_RE, '')

// ─── Log parsing ──────────────────────────────────────────────────────────────

type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE'

export interface ParsedLine {
  id: number
  raw: LogLine
  timestamp: string | null
  timestampMs: number | null   // for time-range filtering
  level: Level | null
  source: string | null
  message: string
  isHttpIn: boolean
  isHttpOut: boolean
  httpMethod: string
  httpPath: string
  httpStatus: number | null
  httpDuration: string
}

const RUST_LOG_RE  = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+([^\s:]+):\s+([\s\S]*)$/
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/
const HTTP_IN_RE   = /^<--\s+(\w+)\s+(.+)$/
const HTTP_OUT_RE  = /^-->\s+(\w+)\s+(.+?)\s+(\d{3})\s+(.*)$/

const LEVEL_ORDER: Record<Level, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3, TRACE: 4 }

let seq = 0

export function parseLogLine(raw: LogLine): ParsedLine {
  const id = ++seq
  const clean = strip(raw.line)

  const httpIn = clean.match(HTTP_IN_RE)
  if (httpIn) return base(id, raw, clean, null, null, null, null, true, false, httpIn[1], httpIn[2], null, '')
  const httpOut = clean.match(HTTP_OUT_RE)
  if (httpOut) return base(id, raw, clean, null, null, null, null, false, true, httpOut[1], httpOut[2], parseInt(httpOut[3], 10), httpOut[4] ?? '')

  const rust = clean.match(RUST_LOG_RE)
  if (rust) {
    const ts = parseIso(rust[1])
    return base(id, raw, rust[4], fmtMs(ts), ts, rust[2] as Level, rust[3], false, false, '', '', null, '')
  }

  const tsMatch = clean.match(TIMESTAMP_RE)
  const ts = tsMatch ? parseIso(tsMatch[1]) : null
  const rest = tsMatch ? clean.slice(tsMatch[1].length).trimStart() : clean
  return base(id, raw, rest, ts ? fmtMs(ts) : null, ts, detectLevel(clean), null, false, false, '', '', null, '')
}

function base(
  id: number, raw: LogLine, message: string,
  timestamp: string | null, timestampMs: number | null,
  level: Level | null, source: string | null,
  isHttpIn: boolean, isHttpOut: boolean,
  httpMethod: string, httpPath: string, httpStatus: number | null, httpDuration: string,
): ParsedLine {
  return { id, raw, timestamp, timestampMs, level, source, message, isHttpIn, isHttpOut, httpMethod, httpPath, httpStatus, httpDuration }
}

function detectLevel(line: string): Level | null {
  const u = line.toUpperCase()
  if (u.includes('ERROR') || u.includes('FATAL') || u.includes('PANIC')) return 'ERROR'
  if (u.includes('WARN'))  return 'WARN'
  if (u.includes(' INFO')) return 'INFO'
  if (u.includes('DEBUG')) return 'DEBUG'
  if (u.includes('TRACE')) return 'TRACE'
  return null
}

function parseIso(iso: string): number { return new Date(iso).getTime() }

function fmtMs(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      // @ts-expect-error -- valid
      fractionalSecondDigits: 3,
    })
  } catch { return '' }
}

// ─── Visual helpers ───────────────────────────────────────────────────────────

const LEVEL_BADGE: Record<Level, string> = {
  ERROR: 'bg-red-100 text-red-700 border border-red-200',
  WARN:  'bg-amber-100 text-amber-700 border border-amber-200',
  INFO:  'bg-blue-100 text-blue-700 border border-blue-200',
  DEBUG: 'bg-gray-100 text-gray-500 border border-gray-200',
  TRACE: 'bg-gray-50 text-gray-400 border border-gray-200',
}
const LEVEL_ROW: Record<Level, string> = {
  ERROR: 'bg-red-50/50', WARN: 'bg-amber-50/30', INFO: '', DEBUG: '', TRACE: 'opacity-60',
}

function LevelBadge({ level }: { level: Level | null }) {
  if (!level) return <span className="w-12 shrink-0" />
  return (
    <span className={`inline-flex items-center justify-center px-1.5 py-px rounded text-xs font-mono font-semibold w-12 shrink-0 ${LEVEL_BADGE[level]}`}>
      {level.slice(0, 4)}
    </span>
  )
}

function statusColor(s: number) {
  if (s < 300) return 'bg-green-100 text-green-800'
  if (s < 500) return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-800'
}

function HttpCell({ l }: { l: ParsedLine }) {
  if (l.isHttpIn) return (
    <span className="flex items-center gap-1.5">
      <span className="text-blue-400 font-mono text-xs select-none">←</span>
      <span className="font-semibold text-blue-700">{l.httpMethod}</span>
      <span className="text-gray-700">{l.httpPath}</span>
    </span>
  )
  const s = l.httpStatus!
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-gray-400 font-mono text-xs select-none">→</span>
      <span className="font-semibold text-gray-600">{l.httpMethod}</span>
      <span className="text-gray-700">{l.httpPath}</span>
      <span className={`px-1.5 py-px rounded text-xs font-mono font-semibold ${statusColor(s)}`}>{s}</span>
      {l.httpDuration && <span className="text-gray-400 text-xs">{l.httpDuration}</span>}
    </span>
  )
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type LevelFilter = 'ALL' | Level
const LEVEL_OPTS: LevelFilter[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']
const STREAM_OPTS = ['all', 'stdout', 'stderr', 'system'] as const
type StreamFilter = (typeof STREAM_OPTS)[number]

// ─── Main component ───────────────────────────────────────────────────────────

export default function LogViewer() {
  const { rawLines, clear } = useLogStore()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // URL-driven time range filter (from TraceViewer deep-link)
  const fromMs = searchParams.get('from') ? Number(searchParams.get('from')) : null
  const toMs   = searchParams.get('to')   ? Number(searchParams.get('to'))   : null
  const traceLabel = searchParams.get('label') ?? null

  const [autoScroll, setAutoScroll] = useState(true)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL')
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all')
  const [search, setSearch] = useState('')
  const bottomRef  = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Parse all raw lines (memoised so we don't re-parse on every keystroke)
  const allLines = useMemo(() => rawLines.map(parseLogLine), [rawLines])

  const filtered = useMemo(() => allLines.filter(l => {
    // Time-range filter from URL params
    if (fromMs !== null || toMs !== null) {
      if (l.timestampMs === null) return false
      if (fromMs !== null && l.timestampMs < fromMs) return false
      if (toMs   !== null && l.timestampMs > toMs)   return false
    }
    if (streamFilter !== 'all' && l.raw.stream !== streamFilter) return false
    if (levelFilter !== 'ALL') {
      if (l.isHttpIn || l.isHttpOut) return false
      if (!l.level) return false
      if (LEVEL_ORDER[l.level] > LEVEL_ORDER[levelFilter as Level]) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!l.message.toLowerCase().includes(q) && !(l.source?.toLowerCase().includes(q))) return false
    }
    return true
  }), [allLines, fromMs, toMs, streamFilter, levelFilter, search])

  useEffect(() => {
    if (autoScroll && !fromMs && !toMs) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [filtered, autoScroll, fromMs, toMs])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const errorCount = allLines.filter(l => l.level === 'ERROR').length

  const clearTimeFilter = () => navigate('/logs')

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Logs</h1>
          {errorCount > 0 && <span className="badge badge-red">{errorCount} errors</span>}
          <span className="text-xs text-gray-400">{allLines.length} total</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {LEVEL_OPTS.map(l => (
              <button
                key={l}
                onClick={() => setLevelFilter(l)}
                className={`px-2.5 py-1.5 transition-colors ${levelFilter === l ? 'bg-fermyon-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >{l}</button>
            ))}
          </div>
          <select className="input text-xs py-1 h-8" value={streamFilter} onChange={e => setStreamFilter(e.target.value as StreamFilter)}>
            {STREAM_OPTS.map(s => <option key={s} value={s}>{s === 'all' ? 'All streams' : s}</option>)}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input text-xs py-1 pl-8 h-8 w-48" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-xs text-gray-400 tabular-nums">{filtered.length}/{allLines.length}</span>
          <button className="btn-secondary text-xs h-8 px-2.5" onClick={clear}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {!fromMs && !toMs && (
            <button
              className={`btn text-xs h-8 px-2.5 ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAutoScroll(v => !v)} title="Auto-scroll"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Time-range filter banner */}
      {(fromMs !== null || toMs !== null) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 shrink-0">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Showing logs during trace
            {traceLabel && <strong className="mx-1">{traceLabel}</strong>}
            {fromMs && <span> from {fmtMs(fromMs)}</span>}
            {toMs   && <span> to {fmtMs(toMs)}</span>}
            {' '}— {filtered.length} matching lines
          </span>
          <button
            className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
            onClick={clearTimeFilter}
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider shrink-0">
        <span className="w-12 shrink-0">Level</span>
        <span className="w-4 shrink-0" />
        <span className="w-24 shrink-0">Time</span>
        <span className="w-36 shrink-0">Source</span>
        <span className="flex-1">Message</span>
      </div>

      {/* Log body */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto font-mono text-xs">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <Search className="w-8 h-8 opacity-25" />
            <p>{allLines.length === 0 ? 'Waiting for log output…' : 'No lines match your filter.'}</p>
          </div>
        ) : (
          filtered.map(l => {
            const isHttp = l.isHttpIn || l.isHttpOut
            const rowCls = l.level ? LEVEL_ROW[l.level] : ''
            return (
              <div
                key={l.id}
                className={`flex items-start px-4 py-px border-b border-gray-50 leading-5 hover:bg-gray-50/70 transition-colors ${rowCls}`}
              >
                <span className="w-12 shrink-0 pt-px">
                  {isHttp ? (
                    <span className={`inline-flex items-center justify-center px-1.5 py-px rounded text-xs font-semibold w-12 ${l.isHttpIn ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                      {l.isHttpIn ? 'REQ' : 'RES'}
                    </span>
                  ) : (
                    <LevelBadge level={l.level} />
                  )}
                </span>
                <span className="w-4 shrink-0" />
                <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{l.timestamp ?? ''}</span>
                <span className="w-36 shrink-0 text-gray-400 truncate pt-px" title={l.source ?? l.raw.stream}>
                  {l.source ? l.source.split('::').pop() : l.raw.stream}
                </span>
                <span className="flex-1 break-all">
                  {isHttp ? (
                    <HttpCell l={l} />
                  ) : (
                    <span className={l.level === 'ERROR' ? 'text-red-700' : l.level === 'WARN' ? 'text-amber-800' : l.level === 'TRACE' ? 'text-gray-400' : 'text-gray-800'}>
                      {l.message}
                    </span>
                  )}
                </span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
