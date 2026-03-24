import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Braces, Check, ChevronDown, ChevronRight, Clock, Copy, Cpu, Pause, Search, Settings2, Trash2, X } from 'lucide-react'
import { useLogStore } from '../store/logContext'
import { useAppStore } from '../store/appContext'
import type { LogLine } from '../api/client'
import { componentTw } from '../componentColors'

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
}

const RUST_LOG_RE  = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+([^\s:]+):\s+([\s\S]*)$/
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/

const LEVEL_ORDER: Record<Level, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3, TRACE: 4 }

let seq = 0

export function parseLogLine(raw: LogLine): ParsedLine {
  const id = ++seq
  const clean = strip(raw.line)

  const rust = clean.match(RUST_LOG_RE)
  if (rust) {
    const ts = parseIso(rust[1])
    return { id, raw, timestamp: fmtMs(ts), timestampMs: ts, level: rust[2] as Level, source: rust[3], message: rust[4] }
  }

  const tsMatch = clean.match(TIMESTAMP_RE)
  const ts = tsMatch ? parseIso(tsMatch[1]) : (raw.receivedAt ?? null)
  const rest = tsMatch ? clean.slice(tsMatch[1].length).trimStart() : clean
  return { id, raw, timestamp: ts ? fmtMs(ts) : null, timestampMs: ts, level: detectLevel(clean), source: null, message: rest }
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
  ERROR: 'badge-red',
  WARN:  'badge-amber',
  INFO:  'badge-blue',
  DEBUG: 'badge-gray',
  TRACE: 'badge-gray opacity-60',
}
const LEVEL_ROW: Record<Level, string> = {
  ERROR: 'bg-red-50/50', WARN: 'bg-amber-50/30', INFO: '', DEBUG: '', TRACE: 'opacity-60',
}

function LevelBadge({ level }: { level: Level | null }) {
  if (!level) return <span className="w-14 shrink-0" />
  return (
    <span className={`inline-flex items-center justify-center badge-sm font-mono font-semibold w-14 shrink-0 ${LEVEL_BADGE[level]}`}>
      {level}
    </span>
  )
}

function msgColor(level: Level | null): string {
  if (level === 'ERROR') return 'text-red-700'
  if (level === 'WARN') return 'text-amber-800'
  if (level === 'TRACE') return 'text-gray-400'
  return 'text-gray-800'
}

// ─── Search highlight ─────────────────────────────────────────────────────────

function HighlightText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        re.test(part)
          ? <mark key={i} className="bg-amber-100 text-inherit rounded-sm px-px">{part}</mark>
          : part
      )}
    </>
  )
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      className={`inline-flex items-center justify-center rounded p-0.5 transition-colors ${
        copied ? 'text-green-500' : 'text-gray-300 hover:text-gray-500'
      } ${className}`}
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

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

function JsonBlock({ group, compact, search }: { group: JsonGroup; compact?: boolean; search?: string }) {
  const first = group.lines[0]
  const pretty = JSON.stringify(group.parsed, null, 2)
  const lineCount = pretty.split('\n').length
  const [open, setOpen] = useState(lineCount <= 6)
  const rowCls = first.level ? LEVEL_ROW[first.level] : ''
  const displayLevel: Level | null = first.level ?? null
  const effectiveRowCls = (displayLevel ? LEVEL_ROW[displayLevel] : '') || rowCls

  const sourceLabel = compact
    ? ''
    : (first.source ? first.source.split('::').pop()! : first.raw.stream)

  return (
    <div className={`group/row border-b border-gray-50 ${effectiveRowCls}`}>
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
          {group.prefix && <span className="text-gray-500 truncate mr-1"><HighlightText text={group.prefix} search={search ?? ''} /></span>}
          {!open && (
            <span className="text-gray-400 italic truncate">
              {Array.isArray(group.parsed)
                ? `[${(group.parsed as unknown[]).length} items]`
                : `{${Object.keys(group.parsed as object).slice(0, 3).join(', ')}${Object.keys(group.parsed as object).length > 3 ? ', \u2026' : ''}}`
              }
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {group.lines.length > 1 && (
              <span className="text-gray-300 text-[10px] tabular-nums">{group.lines.length} lines</span>
            )}
            <CopyButton text={pretty} className="opacity-0 group-hover/row:opacity-100" />
          </span>
        </span>
      </div>
      {open && (
        <div className={`mb-1.5 mt-0.5 rounded-lg bg-gray-50 border border-gray-200 overflow-x-auto ${compact ? 'ml-[6.5rem]' : 'ml-[11.5rem]'} mr-4`}>
          <div className="flex items-center justify-between px-3 pt-1.5">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">JSON</span>
            <CopyButton text={pretty} />
          </div>
          <pre className="px-3 py-1.5 text-xs leading-relaxed whitespace-pre font-mono">
            {colorizeJSON(pretty)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type LevelFilter  = 'ALL' | Level
const LEVEL_OPTS: LevelFilter[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']

// ─── Log row renderers ───────────────────────────────────────────────────────

/** Full 4-column layout used in the Spin tab. */
function SpinLogRow({ l, search }: { l: ParsedLine; search: string }) {
  const rowCls = l.level ? LEVEL_ROW[l.level] : ''
  return (
    <div className={`group/row flex items-start px-4 py-px border-b border-gray-50 leading-5 hover:bg-gray-50/70 transition-colors ${rowCls}`}>
      <span className="w-14 shrink-0 pt-px">
        <LevelBadge level={l.level} />
      </span>
      <span className="w-4 shrink-0" />
      <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{l.timestamp ?? ''}</span>
      <span className="w-36 shrink-0 text-gray-400 truncate pt-px" title={l.source ?? l.raw.stream}>
        {l.source ? l.source.split('::').pop() : l.raw.stream}
      </span>
      <span className="flex-1 flex items-center gap-1 min-w-0">
        <span className={`flex-1 break-all ${msgColor(l.level)}`}>
          <HighlightText text={l.message} search={search} />
        </span>
        <CopyButton text={l.raw.line} className="opacity-0 group-hover/row:opacity-100 shrink-0" />
      </span>
    </div>
  )
}

/** Compact layout used in component tabs. */
function CompLogRow({ l, search }: { l: ParsedLine; search: string }) {
  const displayLevel: Level | null = l.level ?? null
  const rowCls = displayLevel ? LEVEL_ROW[displayLevel] : ''
  return (
    <div className={`group/row flex items-start px-4 py-px border-b border-gray-50 leading-5 hover:bg-gray-50/70 transition-colors ${rowCls}`}>
      <span className="w-14 shrink-0 pt-px">
        <LevelBadge level={displayLevel} />
      </span>
      <span className="w-24 shrink-0 text-gray-400 tabular-nums pt-px">{l.timestamp ?? ''}</span>
      <span className="flex-1 flex items-center gap-1 min-w-0">
        <span className={`flex-1 break-all ${msgColor(displayLevel)}`}>
          <HighlightText text={l.message} search={search} />
        </span>
        <CopyButton text={l.raw.line} className="opacity-0 group-hover/row:opacity-100 shrink-0" />
      </span>
    </div>
  )
}

// ─── Shared log body ──────────────────────────────────────────────────────────

function LogBody({
  groups, compact, search, containerRef, bottomRef, onScroll, empty,
}: {
  groups: RenderGroup[]
  compact: boolean
  search: string
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
          return <JsonBlock key={group.lines[0].id} group={group} compact={compact} search={search} />
        }
        const l = group.line
        return compact
          ? <CompLogRow key={gi} l={l} search={search} />
          : <SpinLogRow key={gi} l={l} search={search} />
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

  // Parse all raw lines once, dropping empty lines
  const allLines = useMemo(() => rawLines
    .filter(r => r.line.trim() !== '')
    .map(parseLogLine), [rawLines])

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
    if (!levelOk(l) || !searchOk(l) || !timeOk(l)) return false
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allLines, levelFilter, search, fromMs, toMs])

  // Lines for the active component tab
  const compLines = useMemo(() => {
    if (activeTab === 'spin') return []
    return allLines.filter(l => {
      if (l.raw.stream !== 'component') return false
      if (l.raw.component !== activeTab) return false
      if (!levelOk(l) || !searchOk(l)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, activeTab, levelFilter, search])

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
              className="input text-xs py-1 pl-8 h-8 w-56"
              placeholder="Search logs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Clear */}
          <button className="btn-ghost btn-icon" onClick={clear} title="Clear log">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {/* Live / Pause toggle */}
          {!fromMs && !toMs && (
            <div className="tab-group">
              <button
                onClick={() => setAutoScroll(true)}
                className={`tab ${autoScroll ? 'tab-active' : ''}`}
                title="Live updates"
              >
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full bg-green-400 ${autoScroll ? 'animate-ping opacity-75' : 'opacity-0'}`} />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
              </button>
              <button
                onClick={() => setAutoScroll(false)}
                className={`tab ${!autoScroll ? 'tab-active' : ''}`}
                title="Pause live updates"
              >
                <Pause className="w-3.5 h-3.5" />
                Paused
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0 overflow-x-auto scrollbar-hide">
        <div className="tab-group">
          {/* Spin tab */}
          <button
            onClick={() => setActiveTab('spin')}
            className={`tab ${activeTab === 'spin' ? 'tab-active' : ''}`}
          >
            <Settings2 className="w-3.5 h-3.5 shrink-0" />
            Spin
            {totalErrors > 0 && (
              <span className="badge-sm badge-red font-semibold">{totalErrors}</span>
            )}
          </button>

          {/* Component tabs */}
          {compIds.map((id) => {
            const pal  = componentTw(id)
            const errs = compErrors(id)
            const isActive = activeTab === id
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`tab ${isActive ? 'tab-active' : ''}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pal.dot}`} />
                <Cpu className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono">{id}</span>
                {errs > 0 && (
                  <span className="badge-sm badge-red font-semibold">{errs}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Spacer + filtered count */}
        <div className="ml-auto flex items-center text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {activeLines.length} / {allLines.length}
        </div>
      </div>

      {/* ── Secondary toolbar (filters) ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white shrink-0 flex-wrap">
        {/* Level filter */}
        <div className="tab-group">
          {LEVEL_OPTS.map(l => (
            <button
              key={l}
              onClick={() => setLevelFilter(l)}
              className={`tab ${levelFilter === l ? 'tab-active' : ''}`}
            >{l === 'ALL' ? 'All' : l}</button>
          ))}
        </div>

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
            {' '}&mdash; {spinLines.length} matching lines
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
        search={search}
        containerRef={containerRef}
        bottomRef={bottomRef}
        onScroll={handleScroll}
        empty={allLines.length === 0
          ? 'Waiting for log output\u2026'
          : activeTab !== 'spin' && allLines.filter(l => l.raw.stream === 'component' && l.raw.component === activeTab).length === 0
            ? `No invocation logs yet for "${activeTab}" \u2014 trigger a request to see output here`
            : 'No lines match your filter.'
        }
      />
    </div>
  )
}
