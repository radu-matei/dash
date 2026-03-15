import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, Braces, ChevronDown, ChevronRight, Clock, Cpu, Search, Settings2, Trash2, X } from 'lucide-react'
import { useLogStore } from '../store/logContext'
import { useAppStore } from '../store/appContext'
import type { LogLine } from '../api/client'

// ─── ANSI stripping ───────────────────────────────────────────────────────────

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g
const strip = (s: string) => s.replace(ANSI_RE, '')

// ─── Log level types and detection ───────────────────────────────────────────

type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE'

export interface ParsedLine {
  id: number
  raw: LogLine
  timestamp: string | null
  timestampMs: number | null
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
  const ts = tsMatch ? parseIso(tsMatch[1]) : (raw.receivedAt ?? null)
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

// Word-boundary regexes prevent false positives (e.g. "thiserror" ≠ ERROR).
const RE_ERROR = /\b(?:ERROR|FATAL|PANIC)\b/
const RE_WARN  = /\bWARN(?:ING)?\b/
const RE_INFO  = /\bINFO\b/
const RE_DEBUG = /\bDEBUG\b/
const RE_TRACE = /\bTRACE\b/

function detectLevel(line: string): Level | null {
  const u = line.toUpperCase()
  if (RE_ERROR.test(u)) return 'ERROR'
  if (RE_WARN.test(u))  return 'WARN'
  if (RE_INFO.test(u))  return 'INFO'
  if (RE_DEBUG.test(u)) return 'DEBUG'
  if (RE_TRACE.test(u)) return 'TRACE'
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
  if (!level) return <span className="w-14 shrink-0" />
  return (
    <span className={`inline-flex items-center justify-center px-1.5 py-px rounded text-xs font-mono font-semibold w-14 shrink-0 ${LEVEL_BADGE[level]}`}>
      {level}
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

// ─── Component color palette ──────────────────────────────────────────────────

const PALETTE = [
  { dot: 'bg-blue-500',    text: 'text-blue-600',    active: 'border-b-2 border-blue-500'    },
  { dot: 'bg-violet-500',  text: 'text-violet-600',  active: 'border-b-2 border-violet-500'  },
  { dot: 'bg-emerald-500', text: 'text-emerald-600', active: 'border-b-2 border-emerald-500' },
  { dot: 'bg-amber-500',   text: 'text-amber-600',   active: 'border-b-2 border-amber-500'   },
  { dot: 'bg-pink-500',    text: 'text-pink-600',    active: 'border-b-2 border-pink-500'    },
  { dot: 'bg-teal-500',    text: 'text-teal-600',    active: 'border-b-2 border-teal-500'    },
  { dot: 'bg-orange-500',  text: 'text-orange-600',  active: 'border-b-2 border-orange-500'  },
  { dot: 'bg-indigo-500',  text: 'text-indigo-600',  active: 'border-b-2 border-indigo-500'  },
]
function palette(idx: number) { return PALETTE[idx % PALETTE.length] }

// ─── JSON detection & grouping ────────────────────────────────────────────────

interface NormalGroup { type: 'normal'; line: ParsedLine }
interface JsonGroup   { type: 'json';   lines: ParsedLine[]; parsed: unknown; prefix: string }
type RenderGroup = NormalGroup | JsonGroup

function extractInlineJSON(msg: string): { parsed: unknown; prefix: string } | null {
  const trimmed = msg.trim()
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c !== '{' && c !== '[') continue
    try {
      const parsed = JSON.parse(trimmed.slice(i))
      return { parsed, prefix: trimmed.slice(0, i).trimEnd() }
    } catch { /* keep scanning */ }
  }
  return null
}

function buildRenderGroups(lines: ParsedLine[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const msg  = line.message.trim()

    const inline = extractInlineJSON(msg)
    if (inline) { groups.push({ type: 'json', lines: [line], ...inline }); i++; continue }

    const lastChar = msg[msg.length - 1]
    if (lastChar === '{' || lastChar === '[') {
      const jsonAt = Math.max(msg.lastIndexOf('{'), msg.lastIndexOf('['))
      let accumulated = msg.slice(jsonAt)
      let depth = 1; let j = i + 1
      while (j < lines.length && depth > 0 && j - i < 500) {
        const next = lines[j].message
        for (const c of next) {
          if (c === '{' || c === '[') depth++
          else if (c === '}' || c === ']') depth--
        }
        accumulated += '\n' + next; j++
        if (depth === 0) break
      }
      if (depth === 0) {
        try {
          const parsed = JSON.parse(accumulated)
          groups.push({ type: 'json', lines: lines.slice(i, j), parsed, prefix: msg.slice(0, jsonAt).trimEnd() })
          i = j; continue
        } catch { /* fall through */ }
      }
    }
    groups.push({ type: 'normal', line }); i++
  }
  return groups
}

// ─── JSON syntax highlighting ─────────────────────────────────────────────────

function colorizeJSON(json: string): React.ReactNode {
  const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g
  const parts: React.ReactNode[] = []
  let last = 0; let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > last) parts.push(json.slice(last, match.index))
    const [full, strToken, colon, numToken, kwToken] = match
    if (strToken !== undefined) {
      if (colon) {
        parts.push(<span key={match.index} className="text-blue-600">{strToken}</span>)
        parts.push(colon)
      } else {
        parts.push(<span key={match.index} className="text-green-700">{strToken}</span>)
      }
    } else if (numToken !== undefined) {
      parts.push(<span key={match.index} className="text-orange-600">{numToken}</span>)
    } else if (kwToken !== undefined) {
      parts.push(<span key={match.index} className="text-purple-600">{kwToken}</span>)
    } else { parts.push(full) }
    last = match.index + full.length
  }
  if (last < json.length) parts.push(json.slice(last))
  return <>{parts}</>
}

// ─── JsonBlock component ──────────────────────────────────────────────────────

function JsonBlock({ group, compact }: { group: JsonGroup; compact?: boolean }) {
  const first = group.lines[0]
  const pretty = JSON.stringify(group.parsed, null, 2)
  const lineCount = pretty.split('\n').length
  const [open, setOpen] = useState(lineCount <= 6)
  const rowCls = first.level ? LEVEL_ROW[first.level] : ''
  const isStderr     = first.raw.subStream === 'stderr'
  const displayLevel: Level | null = first.level ?? (compact && isStderr ? 'ERROR' : null)
  const effectiveRowCls = (displayLevel ? LEVEL_ROW[displayLevel] : '') || rowCls

  const sourceLabel = compact
    ? ''
    : (first.source ? first.source.split('::').pop()! : first.raw.stream)

  return (
    <div className={`border-b border-gray-50 ${effectiveRowCls}`}>
      <div
        className="flex items-start px-4 py-px leading-5 hover:bg-gray-50/70 transition-colors cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <span className="w-14 shrink-0 pt-px"><LevelBadge level={displayLevel} /></span>
        {!compact && <span className="w-4 shrink-0" />}
        <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{first.timestamp ?? ''}</span>
        {!compact && (
          <span className="w-36 shrink-0 text-gray-400 truncate pt-px">{sourceLabel}</span>
        )}
        <span className="flex-1 flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
          <Braces className="w-3 h-3 text-blue-400 shrink-0" />
          {group.prefix && <span className="text-gray-500 truncate mr-1">{group.prefix}</span>}
          {!open && (
            <span className="text-gray-400 italic">
              {Array.isArray(group.parsed)
                ? `[${(group.parsed as unknown[]).length} items]`
                : `{${Object.keys(group.parsed as object).slice(0, 3).join(', ')}${Object.keys(group.parsed as object).length > 3 ? ', …' : ''}}`
              }
            </span>
          )}
          <span className="ml-auto text-gray-300 text-[10px] tabular-nums shrink-0">
            {group.lines.length > 1 ? `${group.lines.length} lines` : ''}
          </span>
        </span>
      </div>
      {open && (
        <div className="mx-4 mb-1.5 mt-0.5 rounded-lg bg-gray-50 border border-gray-200 overflow-x-auto">
          <pre className="px-3 py-2 text-xs leading-relaxed whitespace-pre font-mono">
            {colorizeJSON(pretty)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type LevelFilter  = 'ALL' | Level
type SubStream    = 'both' | 'stdout' | 'stderr'
type StreamFilter = 'all' | 'stdout' | 'stderr' | 'system'

const LEVEL_OPTS: LevelFilter[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']
const STREAM_OPTS: { value: StreamFilter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'stdout', label: 'stdout' },
  { value: 'stderr', label: 'stderr' },
  { value: 'system', label: 'System' },
]

// ─── Tab indicator status ─────────────────────────────────────────────────────

type TabStatus = 'error' | 'warn' | 'active' | 'idle'

function tabStatus(lines: ParsedLine[]): TabStatus {
  if (lines.some(l => l.level === 'ERROR')) return 'error'
  if (lines.some(l => l.level === 'WARN'))  return 'warn'
  if (lines.length > 0)                     return 'active'
  return 'idle'
}

const STATUS_DOT: Record<TabStatus, string> = {
  error:  'bg-red-500',
  warn:   'bg-amber-400',
  active: 'bg-emerald-400',
  idle:   'bg-gray-300',
}

// ─── Log body renderers ───────────────────────────────────────────────────────

/** Full 4-column layout used in the Spin tab. */
function SpinLogRow({ l }: { l: ParsedLine }) {
  const isHttp = l.isHttpIn || l.isHttpOut
  const rowCls = l.level ? LEVEL_ROW[l.level] : ''
  return (
    <div className={`flex items-start px-4 py-px border-b border-gray-50 leading-5 hover:bg-gray-50/70 transition-colors ${rowCls}`}>
      <span className="w-14 shrink-0 pt-px">
        {isHttp ? (
          <span className={`inline-flex items-center justify-center px-1.5 py-px rounded text-xs font-semibold w-14 ${l.isHttpIn ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
            {l.isHttpIn ? 'REQ' : 'RES'}
          </span>
        ) : <LevelBadge level={l.level} />}
      </span>
      <span className="w-4 shrink-0" />
      <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{l.timestamp ?? ''}</span>
      <span className="w-36 shrink-0 text-gray-400 truncate pt-px" title={l.source ?? l.raw.stream}>
        {l.source ? l.source.split('::').pop() : l.raw.stream}
      </span>
      <span className="flex-1 break-all">
        {isHttp ? <HttpCell l={l} /> : (
          <span className={l.level === 'ERROR' ? 'text-red-700' : l.level === 'WARN' ? 'text-amber-800' : l.level === 'TRACE' ? 'text-gray-400' : 'text-gray-800'}>
            {l.message}
          </span>
        )}
      </span>
    </div>
  )
}

/** Compact layout used in component tabs.
 *  stderr lines with no detected level are shown as ERROR for consistency. */
function CompLogRow({ l }: { l: ParsedLine }) {
  const isHttp   = l.isHttpIn || l.isHttpOut
  const isStderr = l.raw.subStream === 'stderr'
  const displayLevel: Level | null = l.level ?? (isStderr ? 'ERROR' : null)
  const rowCls = displayLevel ? LEVEL_ROW[displayLevel] : ''
  return (
    <div className={`flex items-start px-4 py-px border-b border-gray-50 leading-5 hover:bg-gray-50/70 transition-colors ${rowCls}`}>
      <span className="w-14 shrink-0 pt-px">
        {isHttp ? (
          <span className={`inline-flex items-center justify-center px-1.5 py-px rounded text-xs font-semibold w-14 ${l.isHttpIn ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
            {l.isHttpIn ? 'REQ' : 'RES'}
          </span>
        ) : <LevelBadge level={displayLevel} />}
      </span>
      <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{l.timestamp ?? ''}</span>
      <span className="flex-1 break-all">
        {isHttp ? <HttpCell l={l} /> : (
          <span className={displayLevel === 'ERROR' ? 'text-red-700' : displayLevel === 'WARN' ? 'text-amber-800' : displayLevel === 'TRACE' ? 'text-gray-400' : 'text-gray-800'}>
            {l.message}
          </span>
        )}
      </span>
    </div>
  )
}

// ─── Shared log body ──────────────────────────────────────────────────────────

function LogBody({
  groups, compact, containerRef, bottomRef, onScroll, empty,
}: {
  groups: RenderGroup[]
  compact: boolean
  containerRef: React.RefObject<HTMLDivElement>
  bottomRef: React.RefObject<HTMLDivElement>
  onScroll: () => void
  empty: string
}) {
  return (
    <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto font-mono text-xs">
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <Search className="w-8 h-8 opacity-25" />
          <p>{empty}</p>
        </div>
      ) : groups.map((group, gi) => {
        if (group.type === 'json') {
          return <JsonBlock key={group.lines[0].id} group={group} compact={compact} />
        }
        const l = group.line
        return compact
          ? <CompLogRow key={gi} l={l} />
          : <SpinLogRow key={gi} l={l} />
      })}
      <div ref={bottomRef} />
    </div>
  )
}

// ─── Main LogViewer ───────────────────────────────────────────────────────────

type ActiveTab = 'spin' | string  // 'spin' or a component id

export default function LogViewer() {
  const { rawLines, clear } = useLogStore()
  const { app } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // URL-driven time-range filter (from TraceViewer deep-link)
  const fromMs     = searchParams.get('from')  ? Number(searchParams.get('from'))  : null
  const toMs       = searchParams.get('to')    ? Number(searchParams.get('to'))    : null
  const traceLabel = searchParams.get('label') ?? null

  // Tab + filter state
  const [activeTab, setActiveTabRaw]  = useState<ActiveTab>(searchParams.get('component') ?? 'spin')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL')
  const [spinStream, setSpinStream]   = useState<StreamFilter>('all')
  const [subStream, setSubStream]     = useState<SubStream>('both')
  const [search, setSearch]           = useState(searchParams.get('search') ?? '')
  const [autoScroll, setAutoScroll]   = useState(true)

  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabRaw(tab)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (tab === 'spin') next.delete('component')
      else next.set('component', tab)
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    const comp = searchParams.get('component')
    if (comp && comp !== activeTab) setActiveTabRaw(comp)
  }, [searchParams])

  const bottomRef    = useRef<HTMLDivElement>(null!)
  const containerRef = useRef<HTMLDivElement>(null!)

  // Parse all raw lines once
  const allLines = useMemo(() => rawLines.map(parseLogLine), [rawLines])

  // Derive component ids: from app config first, then supplement with
  // whatever component names appear in the log stream.
  const appCompIds  = useMemo(() => app?.components.map(c => c.id) ?? [], [app])
  const logCompIds  = useMemo(() => {
    const seen = new Set<string>()
    for (const l of allLines) {
      if (l.raw.stream === 'component' && l.raw.component) seen.add(l.raw.component)
    }
    return [...seen]
  }, [allLines])
  const compIds = useMemo(() => {
    const merged = [...appCompIds]
    for (const id of logCompIds) {
      if (!merged.includes(id)) merged.push(id)
    }
    return merged
  }, [appCompIds, logCompIds])

  // Helper filters
  const levelOk = (l: ParsedLine) => {
    if (levelFilter === 'ALL') return true
    if (l.isHttpIn || l.isHttpOut) return false
    if (!l.level) return false
    return LEVEL_ORDER[l.level] <= LEVEL_ORDER[levelFilter as Level]
  }
  const searchOk = (l: ParsedLine) => {
    if (!search) return true
    const q = search.toLowerCase()
    return l.message.toLowerCase().includes(q) || !!(l.source?.toLowerCase().includes(q))
  }
  const timeOk = (l: ParsedLine) => {
    if (fromMs === null && toMs === null) return true
    if (l.timestampMs === null) return false
    if (fromMs !== null && l.timestampMs < fromMs) return false
    if (toMs   !== null && l.timestampMs > toMs)   return false
    return true
  }

  // Lines for the Spin tab (process stdout/stderr + system)
  const spinLines = useMemo(() => allLines.filter(l => {
    if (l.raw.stream === 'component') return false
    if (spinStream !== 'all' && l.raw.stream !== spinStream) return false
    if (!levelOk(l) || !searchOk(l) || !timeOk(l)) return false
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allLines, spinStream, levelFilter, search, fromMs, toMs])

  // Lines for the active component tab
  const compLines = useMemo(() => {
    if (activeTab === 'spin') return []
    return allLines.filter(l => {
      if (l.raw.stream !== 'component') return false
      if (l.raw.component !== activeTab) return false
      if (subStream !== 'both' && l.raw.subStream !== subStream) return false
      if (!levelOk(l) || !searchOk(l)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, activeTab, subStream, levelFilter, search])

  const activeLines  = activeTab === 'spin' ? spinLines : compLines
  const renderGroups = useMemo(() => buildRenderGroups(activeLines), [activeLines])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && !(fromMs && toMs)) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [renderGroups, autoScroll, fromMs, toMs])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  // Tab status indicators
  const spinStatus = useMemo(() => tabStatus(
    allLines.filter(l => l.raw.stream !== 'component')
  ), [allLines])

  const compStatuses = useMemo(() => {
    const map: Record<string, TabStatus> = {}
    for (const id of compIds) {
      map[id] = tabStatus(allLines.filter(l => l.raw.stream === 'component' && l.raw.component === id))
    }
    return map
  }, [allLines, compIds])

  const totalErrors = useMemo(() =>
    allLines.filter(l => l.raw.stream !== 'component' && l.level === 'ERROR').length
  , [allLines])

  const compErrors = (id: string) =>
    allLines.filter(l => l.raw.stream === 'component' && l.raw.component === id && l.level === 'ERROR').length

  const clearTimeFilter = () => navigate('/logs')

  const isCompact = activeTab !== 'spin'

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

      {/* ── Title row ───────────────────────────────────────────────────────── */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Logs</h1>
          {totalErrors > 0 && (
            <span className="badge badge-red">{totalErrors} error{totalErrors !== 1 ? 's' : ''}</span>
          )}
          <span className="text-xs text-gray-400">{allLines.length} lines</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input text-xs py-1 pl-8 h-8 w-48"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Clear */}
          <button className="btn-secondary text-xs h-8 px-2.5" onClick={clear} title="Clear log">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {/* Auto-scroll */}
          {!fromMs && !toMs && (
            <button
              className={`btn text-xs h-8 px-2.5 ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAutoScroll(v => !v)}
              title="Auto-scroll to bottom"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-0 border-b border-gray-200 bg-gray-50 px-4 shrink-0 overflow-x-auto">

        {/* Spin tab */}
        <button
          onClick={() => setActiveTab('spin')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors mr-1
            ${activeTab === 'spin'
              ? 'border-b-2 border-spin-oxfordblue text-spin-oxfordblue bg-white -mb-px'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          <Settings2 className="w-3.5 h-3.5 shrink-0" />
          Spin
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[spinStatus]}`} />
          {totalErrors > 0 && (
            <span className="px-1 py-px text-[10px] rounded bg-red-100 text-red-700 font-semibold">{totalErrors}</span>
          )}
        </button>

        {/* Component tabs */}
        {compIds.map((id, idx) => {
          const pal    = palette(idx)
          const status = compStatuses[id] ?? 'idle'
          const errs   = compErrors(id)
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors
                ${isActive
                  ? `bg-white -mb-px ${pal.active} ${pal.text}`
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono">{id}</span>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'idle' ? pal.dot + ' opacity-30' : STATUS_DOT[status]}`} />
              {errs > 0 && (
                <span className="px-1 py-px text-[10px] rounded bg-red-100 text-red-700 font-semibold">{errs}</span>
              )}
            </button>
          )
        })}

        {/* Spacer + filtered count */}
        <div className="ml-auto flex items-center pl-4 pr-1 text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {activeLines.length} / {allLines.length}
        </div>
      </div>

      {/* ── Secondary toolbar (filters) ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white shrink-0 flex-wrap">
        {/* Level filter — shared */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          {LEVEL_OPTS.map(l => (
            <button
              key={l}
              onClick={() => setLevelFilter(l)}
              className={`px-2 py-1 transition-colors ${levelFilter === l ? 'bg-spin-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >{l === 'ALL' ? 'All' : l}</button>
          ))}
        </div>

        {/* Spin tab: stream filter */}
        {activeTab === 'spin' && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {STREAM_OPTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSpinStream(s.value)}
                className={`px-2.5 py-1 transition-colors ${spinStream === s.value ? 'bg-spin-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >{s.label}</button>
            ))}
          </div>
        )}

        {/* Component tab: stdout/stderr toggle */}
        {activeTab !== 'spin' && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['both', 'stdout', 'stderr'] as SubStream[]).map(s => (
              <button
                key={s}
                onClick={() => setSubStream(s)}
                className={`px-2.5 py-1 transition-colors ${subStream === s
                  ? s === 'stderr' ? 'bg-rose-600 text-white' : 'bg-spin-oxfordblue text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >{s}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Time-range filter banner (Spin tab only) ─────────────────────────── */}
      {activeTab === 'spin' && (fromMs !== null || toMs !== null) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 shrink-0">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Showing logs during trace
            {traceLabel && <strong className="mx-1">{traceLabel}</strong>}
            {fromMs && <span> from {fmtMs(fromMs)}</span>}
            {toMs   && <span> to {fmtMs(toMs)}</span>}
            {' '}— {spinLines.length} matching lines
          </span>
          <button
            className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
            onClick={clearTimeFilter}
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        </div>
      )}

      {/* ── Column headers ───────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider shrink-0">
        <span className="w-14 shrink-0">Level</span>
        {!isCompact && <span className="w-4 shrink-0" />}
        <span className="w-24 shrink-0">Time</span>
        {!isCompact && <span className="w-36 shrink-0">Source</span>}
        <span className="flex-1">Message</span>
      </div>

      {/* ── Log body ─────────────────────────────────────────────────────────── */}
      <LogBody
        groups={renderGroups}
        compact={isCompact}
        containerRef={containerRef}
        bottomRef={bottomRef}
        onScroll={handleScroll}
        empty={allLines.length === 0
          ? 'Waiting for log output…'
          : activeTab !== 'spin' && allLines.filter(l => l.raw.stream === 'component' && l.raw.component === activeTab).length === 0
            ? `No invocation logs yet for "${activeTab}" — trigger a request to see output here`
            : 'No lines match your filter.'
        }
      />
    </div>
  )
}
