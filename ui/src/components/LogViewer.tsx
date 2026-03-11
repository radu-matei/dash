import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, Braces, ChevronDown, ChevronRight, Clock, Search, Trash2, X } from 'lucide-react'
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

// Word-boundary regexes prevent false positives from crate names like
// "thiserror" (contains ERROR) or "tracing" (contains TRACE).
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

// ─── JSON detection & grouping ────────────────────────────────────────────────

interface NormalGroup { type: 'normal'; line: ParsedLine }
interface JsonGroup   { type: 'json';   lines: ParsedLine[]; parsed: unknown; prefix: string }
type RenderGroup = NormalGroup | JsonGroup

/** Try to extract a JSON value from msg. Returns the parsed object and any non-JSON prefix.
 *
 * Scans left-to-right for the first `{` or `[` from which the remainder of the
 * string is valid JSON.  This handles all of:
 *   - full-line JSON:            `{"key": 1}`
 *   - after a separator:        `Error: {"code": 401}`
 *   - after any prefix text:    `[ADK INFO] event: {...}`
 *   - nested JSON in text:      `failed (401): {"error": {...}}`
 */
function extractInlineJSON(msg: string): { parsed: unknown; prefix: string } | null {
  const trimmed = msg.trim()
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c !== '{' && c !== '[') continue
    try {
      const parsed = JSON.parse(trimmed.slice(i))
      return { parsed, prefix: trimmed.slice(0, i).trimEnd() }
    } catch { /* not valid JSON from here; keep scanning */ }
  }
  return null
}

/**
 * Group consecutive ParsedLines into render groups.
 * Lines that together form a valid JSON value are coalesced into a JsonGroup
 * so they can be rendered as formatted JSON rather than raw text fragments.
 */
function buildRenderGroups(lines: ParsedLine[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const msg  = line.message.trim()

    // 1. Single-line or inline JSON
    const inline = extractInlineJSON(msg)
    if (inline) {
      groups.push({ type: 'json', lines: [line], ...inline })
      i++
      continue
    }

    // 2. Multi-line JSON block: the line ends with a bare `{` or `[`.
    //    Covers both a bare `{` on its own AND lines like
    //    "Memory Bank failed (401): {" where JSON starts after some prefix text.
    const lastChar = msg[msg.length - 1]
    if (lastChar === '{' || lastChar === '[') {
      // Find the JSON start: position of the last `{` or `[` in the line.
      const braceAt   = msg.lastIndexOf('{')
      const bracketAt = msg.lastIndexOf('[')
      const jsonAt    = Math.max(braceAt, bracketAt)

      let accumulated = msg.slice(jsonAt)   // opening brace/bracket onward
      let depth = 1
      let j = i + 1
      const MAX_LINES = 500

      while (j < lines.length && depth > 0 && j - i < MAX_LINES) {
        const next = lines[j].message
        for (const c of next) {
          if (c === '{' || c === '[') depth++
          else if (c === '}' || c === ']') depth--
        }
        accumulated += '\n' + next
        j++
        if (depth === 0) break
      }

      if (depth === 0) {
        try {
          const parsed = JSON.parse(accumulated)
          const prefix = msg.slice(0, jsonAt).trimEnd()
          groups.push({ type: 'json', lines: lines.slice(i, j), parsed, prefix })
          i = j
          continue
        } catch { /* accumulated text wasn't valid JSON; fall through */ }
      }
    }

    groups.push({ type: 'normal', line })
    i++
  }

  return groups
}

// ─── JSON syntax highlighting ─────────────────────────────────────────────────

/** Colorise a JSON.stringify output string with spans. Pure regex — no tree walk. */
function colorizeJSON(json: string): React.ReactNode {
  // Split on tokens we care about, keeping the delimiters
  const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > last) parts.push(json.slice(last, match.index))
    const [full, strToken, colon, numToken, kwToken] = match
    if (strToken !== undefined) {
      if (colon) {
        // It's a key
        parts.push(<span key={match.index} className="text-blue-600">{strToken}</span>)
        parts.push(colon)
      } else {
        parts.push(<span key={match.index} className="text-green-700">{strToken}</span>)
      }
    } else if (numToken !== undefined) {
      parts.push(<span key={match.index} className="text-orange-600">{numToken}</span>)
    } else if (kwToken !== undefined) {
      parts.push(<span key={match.index} className="text-purple-600">{kwToken}</span>)
    } else {
      parts.push(full)
    }
    last = match.index + full.length
  }
  if (last < json.length) parts.push(json.slice(last))
  return <>{parts}</>
}

// ─── JsonBlock component ──────────────────────────────────────────────────────

function JsonBlock({ group }: { group: JsonGroup }) {
  const first = group.lines[0]
  const pretty = JSON.stringify(group.parsed, null, 2)
  const lineCount = pretty.split('\n').length
  const [open, setOpen] = useState(lineCount <= 6)

  const rowCls = first.level ? LEVEL_ROW[first.level] : ''

  return (
    <div className={`border-b border-gray-50 ${rowCls}`}>
      {/* Metadata row — same layout as normal lines */}
      <div
        className="flex items-start px-4 py-px leading-5 hover:bg-gray-50/70 transition-colors cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <span className="w-12 shrink-0 pt-px"><LevelBadge level={first.level} /></span>
        <span className="w-4 shrink-0" />
        <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{first.timestamp ?? ''}</span>
        <span className="w-36 shrink-0 text-gray-400 truncate pt-px" title={first.source ?? first.raw.stream}>
          {first.source ? first.source.split('::').pop() : first.raw.stream}
        </span>
        <span className="flex-1 flex items-center gap-1.5 min-w-0">
          {open
            ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
            : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
          }
          <Braces className="w-3 h-3 text-blue-400 shrink-0" />
          {group.prefix && (
            <span className="text-gray-500 truncate mr-1">{group.prefix}</span>
          )}
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

      {/* Formatted JSON */}
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

  // Group filtered lines into normal lines and coalesced JSON blocks
  const renderGroups = useMemo(() => buildRenderGroups(filtered), [filtered])

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
                className={`px-2.5 py-1.5 transition-colors ${levelFilter === l ? 'bg-spin-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
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
        {renderGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <Search className="w-8 h-8 opacity-25" />
            <p>{allLines.length === 0 ? 'Waiting for log output…' : 'No lines match your filter.'}</p>
          </div>
        ) : (
          renderGroups.map((group, gi) => {
            if (group.type === 'json') return <JsonBlock key={group.lines[0].id} group={group} />

            const l = group.line
            const isHttp = l.isHttpIn || l.isHttpOut
            const rowCls = l.level ? LEVEL_ROW[l.level] : ''
            return (
              <div
                key={gi}
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
