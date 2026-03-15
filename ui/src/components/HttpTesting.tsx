import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, Braces, Check, ChevronDown, ChevronRight, Clock,
  ExternalLink, FlaskConical, FolderOpen, Loader2, Lock,
  Minus, Play, Plus, RefreshCw, Save, Search, Trash2, X,
} from 'lucide-react'
import { useAppStore } from '../store/appContext'
import { useTestRuns } from '../store/testRunContext'
import {
  type HurlTestFile, type HurlTestListResponse, type HurlRunResult,
  type VarEntry,
  getHurlTests, getHurlFile, saveHurlFile, runHurlTest,
  getVars,
  type TriggerInfo,
} from '../api/client'

// ─── Hurl file icon (derived from the official Hurl logo arrows) ─────────────

function HurlIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Hurl file">
      <path d="M3,4 H15 V2 L21,7 L15,12 V10 H3 Z" fill="#ff0288" />
      <path d="M21,14 H9 V12 L3,17 L9,22 V20 H21 Z" fill="#ff0288" />
    </svg>
  )
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const
type HttpMethod = typeof HTTP_METHODS[number]

const STATUS_CODES = [
  { value: '200', label: '200 OK' },
  { value: '201', label: '201 Created' },
  { value: '204', label: '204 No Content' },
  { value: '301', label: '301 Moved' },
  { value: '302', label: '302 Found' },
  { value: '400', label: '400 Bad Request' },
  { value: '401', label: '401 Unauthorized' },
  { value: '403', label: '403 Forbidden' },
  { value: '404', label: '404 Not Found' },
  { value: '500', label: '500 Server Error' },
] as const

const ASSERTION_TYPES = [
  { value: 'jsonpath', label: 'JSONPath', placeholder: '$.status' },
  { value: 'header', label: 'Header', placeholder: 'Content-Type' },
  { value: 'body', label: 'Body contains', placeholder: '' },
  { value: 'duration', label: 'Duration <', placeholder: '1000' },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function groupByDir(files: HurlTestFile[]): Map<string, HurlTestFile[]> {
  const map = new Map<string, HurlTestFile[]>()
  for (const f of files) {
    const dir = f.dir === '.' ? '/' : f.dir
    const arr = map.get(dir) ?? []
    arr.push(f)
    map.set(dir, arr)
  }
  return map
}

function httpRoutes(triggers: TriggerInfo[]): { route: string; component: string }[] {
  return triggers
    .filter(t => t.type === 'http' && t.route && !t.private)
    .map(t => ({ route: t.route!, component: t.component }))
}

// ─── Hurl syntax highlighting ────────────────────────────────────────────────

const HURL_SECTIONS = new Set([
  'QueryStringParams', 'Query', 'FormParams', 'Form', 'MultipartFormData',
  'Multipart', 'Cookies', 'Captures', 'Asserts', 'Options', 'BasicAuth',
])

const ASSERT_KW = new Set([
  'jsonpath', 'xpath', 'header', 'cookie', 'body', 'bytes', 'sha256', 'md5',
  'status', 'url', 'duration', 'certificate', 'ip', 'variable', 'regex',
])

function renderWithTemplates(text: string, baseCls: string): ReactNode {
  if (!text) return null
  const parts = text.split(/(\{\{.*?\}\}|"[^"]*")/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('{{') && part.endsWith('}}'))
          return <span key={i} className="text-orange-600">{part}</span>
        if (part.startsWith('"') && part.endsWith('"'))
          return <span key={i} className="text-amber-700">{part}</span>
        return <span key={i} className={baseCls}>{part}</span>
      })}
    </>
  )
}

function renderAssertRest(text: string): ReactNode {
  const parts = text.split(
    /(\{\{.*?\}\}|"[^"]*"|\b(?:==|!=|>=|<=|>|<|contains|includes|startsWith|endsWith|matches|exists|isInteger|isFloat|isBoolean|isString|isCollection|not exists|not|count)\b)/g
  )
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('{{') && part.endsWith('}}'))
          return <span key={i} className="text-orange-600">{part}</span>
        if (part.startsWith('"') && part.endsWith('"'))
          return <span key={i} className="text-amber-700">{part}</span>
        if (/^(==|!=|>=|<=|>|<|contains|includes|startsWith|endsWith|matches|exists|isInteger|isFloat|isBoolean|isString|isCollection|not exists|not|count)$/.test(part))
          return <span key={i} className="text-pink-600 font-semibold">{part}</span>
        if (/^\s*\d+(\.\d+)?\s*$/.test(part))
          return <span key={i} className="text-purple-600">{part}</span>
        return <span key={i} className="text-gray-500">{part}</span>
      })}
    </>
  )
}

function highlightHurlLine(line: string): ReactNode {
  if (!line) return ' '

  if (/^\s*#/.test(line))
    return <span className="text-gray-400 italic">{line}</span>

  const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b(.*)/)
  if (methodMatch) {
    return (
      <>
        <span className="text-emerald-600 font-bold">{methodMatch[1]}</span>
        {renderWithTemplates(methodMatch[2], 'text-blue-600')}
      </>
    )
  }

  const httpMatch = line.match(/^(HTTP(?:\/[\d.]+)?)\s+(\*|\d{3})(.*)/)
  if (httpMatch) {
    const code = httpMatch[2] === '*' ? 0 : parseInt(httpMatch[2])
    const statusCls =
      code >= 500 ? 'text-red-600 font-bold' :
      code >= 400 ? 'text-amber-600 font-bold' :
      code >= 300 ? 'text-yellow-600 font-bold' :
      code === 0  ? 'text-gray-500 font-bold' :
      'text-emerald-600 font-bold'
    return (
      <>
        <span className="text-purple-600 font-bold">{httpMatch[1]}</span>
        <span className="text-gray-400"> </span>
        <span className={statusCls}>{httpMatch[2]}</span>
        {httpMatch[3] && <span className="text-gray-500">{httpMatch[3]}</span>}
      </>
    )
  }

  const sectionMatch = line.match(/^(\[)(\w+)(\])(.*)/)
  if (sectionMatch && HURL_SECTIONS.has(sectionMatch[2])) {
    return (
      <>
        <span className="text-purple-500">{sectionMatch[1]}</span>
        <span className="text-purple-600 font-bold">{sectionMatch[2]}</span>
        <span className="text-purple-500">{sectionMatch[3]}</span>
        {sectionMatch[4] && <span className="text-gray-500">{sectionMatch[4]}</span>}
      </>
    )
  }

  const headerMatch = line.match(/^([A-Za-z][\w-]*)(\s*:\s*)(.*)$/)
  if (headerMatch) {
    return (
      <>
        <span className="text-teal-600">{headerMatch[1]}</span>
        <span className="text-gray-400">{headerMatch[2]}</span>
        {renderWithTemplates(headerMatch[3], 'text-gray-700')}
      </>
    )
  }

  const trimmed = line.trimStart()
  const indent = line.slice(0, line.length - trimmed.length)
  const firstWord = trimmed.split(/\s/)[0]
  if (ASSERT_KW.has(firstWord)) {
    return (
      <>
        {indent && <span>{indent}</span>}
        <span className="text-cyan-700 font-medium">{firstWord}</span>
        {renderAssertRest(trimmed.slice(firstWord.length))}
      </>
    )
  }

  return renderWithTemplates(line, 'text-gray-800')
}

// Shared style ensuring the <pre> and <textarea> have identical metrics.
const EDITOR_STYLE: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  fontSize: '12px',
  lineHeight: '20px',
  padding: '16px',
  margin: 0,
  border: 'none',
  outline: 'none',
  tabSize: 2,
  letterSpacing: 'normal',
  wordSpacing: 'normal',
}

function HurlEditor({ value, onChange, readOnly, placeholder }: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  placeholder?: string
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const highlighted = useMemo(() => {
    if (!value && placeholder)
      return <span className="text-gray-400 italic">{placeholder}</span>
    const lines = value.split('\n')
    return lines.map((line, i) => (
      <Fragment key={i}>
        {i > 0 && '\n'}
        {highlightHurlLine(line)}
      </Fragment>
    ))
  }, [value, placeholder])

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = value.slice(0, start) + '  ' + value.slice(end)
      onChange(next)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  if (readOnly) {
    return (
      <pre
        className="flex-1 overflow-auto m-0 whitespace-pre bg-gray-50"
        style={EDITOR_STYLE}
      >
        {highlighted}
        {'\n'}
      </pre>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-white">
      <pre
        ref={preRef}
        className="absolute inset-0 m-0 overflow-hidden whitespace-pre pointer-events-none select-none"
        style={EDITOR_STYLE}
        aria-hidden="true"
      >
        {highlighted}
        {'\n'}
      </pre>
      <textarea
        ref={taRef}
        className="absolute inset-0 w-full h-full m-0 whitespace-pre bg-transparent resize-none"
        style={{ ...EDITOR_STYLE, color: 'transparent', caretColor: '#1f2937' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        wrap="off"
      />
    </div>
  )
}

// ─── Assertion builder row ───────────────────────────────────────────────────

interface Assertion {
  type: string
  selector: string
  predicate: string
  value: string
}

function AssertionRow({
  assertion, onChange, onRemove,
}: {
  assertion: Assertion
  onChange: (a: Assertion) => void
  onRemove: () => void
}) {
  const typeDef = ASSERTION_TYPES.find(t => t.value === assertion.type)
  return (
    <div className="flex items-center gap-2">
      <select
        className="input text-xs py-1 w-28"
        value={assertion.type}
        onChange={e => onChange({ ...assertion, type: e.target.value, selector: '', predicate: '==', value: '' })}
      >
        {ASSERTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {(assertion.type === 'jsonpath' || assertion.type === 'header') && (
        <input
          className="input-mono text-xs py-1 flex-1"
          placeholder={typeDef?.placeholder}
          value={assertion.selector}
          onChange={e => onChange({ ...assertion, selector: e.target.value })}
        />
      )}

      {assertion.type !== 'body' && assertion.type !== 'duration' && (
        <select
          className="input text-xs py-1 w-20"
          value={assertion.predicate}
          onChange={e => onChange({ ...assertion, predicate: e.target.value })}
        >
          <option value="==">==</option>
          <option value="!=">!=</option>
          <option value="contains">contains</option>
          <option value="startsWith">startsWith</option>
          <option value="exists">exists</option>
          <option value="not exists">not exists</option>
          <option value="matches">matches</option>
          <option value=">">{'>'}</option>
          <option value="<">{'<'}</option>
          <option value=">=">{'≥'}</option>
          <option value="<=">{'≤'}</option>
        </select>
      )}

      {assertion.predicate !== 'exists' && assertion.predicate !== 'not exists' && (
        <input
          className="input-mono text-xs py-1 flex-1"
          placeholder={assertion.type === 'duration' ? 'ms' : assertion.type === 'body' ? 'text to find' : 'expected value'}
          value={assertion.value}
          onChange={e => onChange({ ...assertion, value: e.target.value })}
        />
      )}

      <button onClick={onRemove} className="text-gray-400 hover:text-red-500 p-1">
        <Minus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Header row ──────────────────────────────────────────────────────────────

function HeaderRow({
  header, onChange, onRemove,
}: {
  header: { key: string; value: string }
  onChange: (h: { key: string; value: string }) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="input-mono text-xs py-1 w-40"
        placeholder="Header name"
        value={header.key}
        onChange={e => onChange({ ...header, key: e.target.value })}
      />
      <span className="text-gray-400 text-xs">:</span>
      <input
        className="input-mono text-xs py-1 flex-1"
        placeholder="Value"
        value={header.value}
        onChange={e => onChange({ ...header, value: e.target.value })}
      />
      <button onClick={onRemove} className="text-gray-400 hover:text-red-500 p-1">
        <Minus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Hurl code generator ─────────────────────────────────────────────────────

interface TestEntry {
  method: HttpMethod
  url: string
  headers: { key: string; value: string }[]
  body: string
  expectedStatus: string
  assertions: Assertion[]
}

function generateHurl(entries: TestEntry[]): string {
  const lines: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (i > 0) lines.push('')

    lines.push(`${e.method} ${e.url}`)

    for (const h of e.headers) {
      if (h.key && h.value) lines.push(`${h.key}: ${h.value}`)
    }

    if (e.body.trim() && ['POST', 'PUT', 'PATCH'].includes(e.method)) {
      // Auto-add Content-Type if it looks like JSON and header isn't set
      const hasContentType = e.headers.some(h => h.key.toLowerCase() === 'content-type')
      if (!hasContentType && e.body.trim().startsWith('{')) {
        lines.push('Content-Type: application/json')
      }
      lines.push(e.body.trim())
    }

    if (e.expectedStatus) {
      lines.push(`HTTP ${e.expectedStatus}`)
    }

    const validAssertions = e.assertions.filter(a => {
      if (a.type === 'duration') return a.value
      if (a.type === 'body') return a.value
      if (a.predicate === 'exists' || a.predicate === 'not exists') return a.selector
      return a.selector && a.value
    })

    if (validAssertions.length > 0) {
      lines.push('[Asserts]')
      for (const a of validAssertions) {
        if (a.type === 'body') {
          lines.push(`body contains "${a.value}"`)
        } else if (a.type === 'duration') {
          lines.push(`duration < ${a.value}`)
        } else if (a.predicate === 'exists' || a.predicate === 'not exists') {
          lines.push(`${a.type} "${a.selector}" ${a.predicate}`)
        } else {
          const val = a.value.match(/^\d+$/) ? a.value : `"${a.value}"`
          lines.push(`${a.type} "${a.selector}" ${a.predicate} ${val}`)
        }
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}

function emptyEntry(): TestEntry {
  return {
    method: 'GET',
    url: '{{base_url}}/',
    headers: [],
    body: '',
    expectedStatus: '200',
    assertions: [],
  }
}

// ─── Request card (used inside NewTestBuilder) ──────────────────────────────

function RequestCard({
  entry, index, total, routes, onChange, onRemove,
}: {
  entry: TestEntry
  index: number
  total: number
  routes: { route: string; component: string }[]
  onChange: (patch: Partial<TestEntry>) => void
  onRemove: (() => void) | null
}) {
  const [showHeaders, setShowHeaders] = useState(entry.headers.length > 0)
  const [showAsserts, setShowAsserts] = useState(entry.assertions.length > 0)
  const needsBody = ['POST', 'PUT', 'PATCH'].includes(entry.method)
  const [showBody, setShowBody] = useState(!!entry.body.trim())

  return (
    <div className="card">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">
            {total > 1 ? `Request ${index + 1}` : 'Request'}
          </span>
          {index > 0 && (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">chained</span>
          )}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-red-50 transition-colors"
            title="Remove request"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Method + URL */}
        <div className="flex gap-2">
          <select
            className="input text-sm py-2 w-28 font-mono font-semibold"
            value={entry.method}
            onChange={e => onChange({ method: e.target.value as HttpMethod })}
          >
            {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
          <input
            className="input-mono text-sm py-2 flex-1"
            placeholder="{{base_url}}/api/..."
            value={entry.url}
            onChange={e => onChange({ url: e.target.value })}
            autoFocus={index === 0}
          />
        </div>

        {/* Route quick picks */}
        {routes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-gray-400 self-center">Routes:</span>
            {routes.map(r => (
              <button
                key={r.route}
                onClick={() => onChange({ url: `{{base_url}}${r.route.replace(/\/\.\.\.$/g, '/')}` })}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                title={`Component: ${r.component}`}
              >
                {r.route}
                <span className="text-gray-400 font-sans text-[10px]">{r.component}</span>
              </button>
            ))}
          </div>
        )}

        {/* Collapsible sections */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            onClick={() => {
              setShowHeaders(v => !v)
              if (!showHeaders && entry.headers.length === 0) onChange({ headers: [{ key: '', value: '' }] })
            }}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showHeaders ? 'bg-spin-seagreen/15 text-spin-oxfordblue' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Headers{entry.headers.length > 0 && ` (${entry.headers.length})`}
          </button>
          {needsBody && (
            <button
              onClick={() => setShowBody(v => !v)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                showBody ? 'bg-spin-seagreen/15 text-spin-oxfordblue' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Body
            </button>
          )}
          <button
            onClick={() => {
              setShowAsserts(v => !v)
              if (!showAsserts && entry.assertions.length === 0)
                onChange({ assertions: [{ type: 'jsonpath', selector: '', predicate: '==', value: '' }] })
            }}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showAsserts ? 'bg-spin-seagreen/15 text-spin-oxfordblue' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Assertions{entry.assertions.length > 0 && ` (${entry.assertions.length})`}
          </button>
        </div>

        {/* Headers */}
        {showHeaders && (
          <div className="space-y-1.5 pl-1 border-l-2 border-spin-seagreen/30 ml-1">
            {entry.headers.map((h, i) => (
              <HeaderRow
                key={i}
                header={h}
                onChange={val => onChange({ headers: entry.headers.map((old, j) => j === i ? val : old) })}
                onRemove={() => onChange({ headers: entry.headers.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              onClick={() => onChange({ headers: [...entry.headers, { key: '', value: '' }] })}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 py-0.5"
            >
              <Plus className="w-3 h-3" /> Add header
            </button>
          </div>
        )}

        {/* Body */}
        {needsBody && showBody && (
          <div className="pl-1 border-l-2 border-spin-seagreen/30 ml-1">
            <textarea
              className="input-mono text-xs w-full h-24 resize-y"
              placeholder={'{\n  "key": "value"\n}'}
              value={entry.body}
              onChange={e => onChange({ body: e.target.value })}
            />
          </div>
        )}

        {/* Expected status (always visible, inline) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Expect</span>
          <select
            className="input text-xs py-1 w-36"
            value={STATUS_CODES.some(s => s.value === entry.expectedStatus) ? entry.expectedStatus : '_custom'}
            onChange={e => {
              if (e.target.value === '_custom') return
              onChange({ expectedStatus: e.target.value })
            }}
          >
            <option value="">No status check</option>
            {STATUS_CODES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            {entry.expectedStatus && !STATUS_CODES.some(s => s.value === entry.expectedStatus) && (
              <option value="_custom">Custom: {entry.expectedStatus}</option>
            )}
          </select>
          <input
            className="input-mono text-xs py-1 w-16"
            placeholder="code"
            value={entry.expectedStatus}
            onChange={e => onChange({ expectedStatus: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          />
        </div>

        {/* Assertions */}
        {showAsserts && (
          <div className="space-y-1.5 pl-1 border-l-2 border-spin-seagreen/30 ml-1">
            {entry.assertions.map((a, i) => (
              <AssertionRow
                key={i}
                assertion={a}
                onChange={val => onChange({ assertions: entry.assertions.map((old, j) => j === i ? val : old) })}
                onRemove={() => onChange({ assertions: entry.assertions.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              onClick={() => onChange({
                assertions: [...entry.assertions, { type: 'jsonpath', selector: '', predicate: '==', value: '' }],
              })}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 py-0.5"
            >
              <Plus className="w-3 h-3" /> Add assertion
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Test Builder ────────────────────────────────────────────────────────

function NewTestBuilder({
  routes,
  defaultDir,
  onSave,
  onCancel,
}: {
  routes: { route: string; component: string }[]
  defaultDir: string
  onSave: (path: string, content: string) => void
  onCancel: () => void
}) {
  const [testName, setTestName] = useState('')
  const [testDir, setTestDir] = useState(defaultDir)
  const [entries, setEntries] = useState<TestEntry[]>([emptyEntry()])

  const updateEntry = (idx: number, patch: Partial<TestEntry>) =>
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...patch } : e))

  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }

  const addEntry = () => setEntries(prev => [...prev, emptyEntry()])

  const preview = useMemo(() => generateHurl(entries), [entries])

  const canSave = testName.trim() && entries.every(e => e.url.trim())

  const handleSave = () => {
    const safeName = testName.trim().replace(/\s+/g, '-').toLowerCase()
    const fileName = safeName.endsWith('.hurl') ? safeName : `${safeName}.hurl`
    const path = testDir ? `${testDir}/${fileName}` : fileName
    onSave(path, preview)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with file name */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0 mr-4">
          <FlaskConical className="w-4 h-4 text-spin-seagreen shrink-0" />
          <input
            className="input text-sm h-8 w-48"
            placeholder="test-name"
            value={testName}
            onChange={e => setTestName(e.target.value)}
            autoFocus
          />
          <span className="text-gray-300 text-sm">/</span>
          <input
            className="input text-sm h-8 w-24 text-gray-500"
            placeholder="tests"
            value={testDir}
            onChange={e => setTestDir(e.target.value)}
          />
          {testName && (
            <span className="text-xs text-gray-400 font-mono truncate">
              → {testDir ? `${testDir}/` : ''}{testName.trim().replace(/\s+/g, '-').toLowerCase()}{testName.endsWith('.hurl') ? '' : '.hurl'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onCancel} className="btn-secondary text-xs h-8 px-3">Cancel</button>
          <button onClick={handleSave} disabled={!canSave} className="btn-primary text-xs h-8 px-3">
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Request cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {entries.map((entry, i) => (
            <RequestCard
              key={i}
              entry={entry}
              index={i}
              total={entries.length}
              routes={routes}
              onChange={patch => updateEntry(i, patch)}
              onRemove={entries.length > 1 ? () => removeEntry(i) : null}
            />
          ))}

          <button
            onClick={addEntry}
            className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-spin-seagreen/40 hover:text-spin-midgreen hover:bg-spin-seagreen/5 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Chain another request
          </button>
        </div>

        {/* Live preview — always visible, with syntax highlighting */}
        <div className="w-80 border-l border-gray-200 flex flex-col bg-white shrink-0">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 shrink-0">
            <span className="text-xs font-semibold text-gray-600">Generated Hurl</span>
            <span className="text-[10px] text-gray-400">live preview</span>
          </div>
          <div className="flex-1 overflow-auto">
            {preview.trim() ? (
              <HurlEditor value={preview} onChange={() => {}} readOnly />
            ) : (
              <div className="flex items-center justify-center h-full p-4">
                <p className="text-xs text-gray-400 text-center">
                  Fill in a request to see the generated Hurl syntax
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Run output viewer ───────────────────────────────────────────────────────

function tryPrettyJson(text: string): string | null {
  const start = text.search(/[{\[]/)
  if (start < 0) return null
  const candidate = text.slice(start)
  if (candidate.length < 40) return null
  try {
    const parsed = JSON.parse(candidate)
    const prefix = text.slice(0, start)
    return prefix + JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

function classifyLine(line: string): string {
  if (line.includes('* ')) return 'text-blue-700'
  if (line.includes('> ')) return 'text-emerald-700'
  if (line.includes('< ')) return 'text-amber-700'
  if (/error/i.test(line) || /failed/i.test(line)) return 'text-red-600'
  if (/\bRunning\b/.test(line) || /\bExecuting\b/.test(line)) return 'text-cyan-700'
  if (line.startsWith('  ')) return 'text-gray-500'
  return 'text-gray-600'
}

function OutputLines({ output }: { output: string }) {
  const rendered = useMemo(() => {
    const raw = output.split('\n')
    const result: { key: number; cls: string; text: string }[] = []
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i]
      const cls = classifyLine(line)
      const pretty = tryPrettyJson(line)
      if (pretty) {
        const prettyLines = pretty.split('\n')
        for (let j = 0; j < prettyLines.length; j++) {
          result.push({ key: i * 10000 + j, cls: j === 0 ? cls : 'text-gray-700', text: prettyLines[j] })
        }
      } else {
        result.push({ key: i, cls, text: line })
      }
    }
    return result
  }, [output])

  return (
    <>
      {rendered.map(r => (
        <div key={r.key} className={r.cls}>{r.text || '\u00A0'}</div>
      ))}
    </>
  )
}

function RunOutput({ result, onViewTraces }: { result: HurlRunResult; onViewTraces: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary bar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b shrink-0 ${
        result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-3">
          {result.success
            ? <Check className="w-4 h-4 text-green-600" />
            : <AlertCircle className="w-4 h-4 text-red-600" />
          }
          <span className={`text-sm font-semibold ${result.success ? 'text-green-800' : 'text-red-800'}`}>
            {result.success ? 'All tests passed' : 'Tests failed'}
          </span>
          <span className="badge badge-gray font-mono">{fmtDuration(result.durationMs)}</span>
          {result.exitCode !== 0 && (
            <span className="badge badge-red">exit {result.exitCode}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onViewTraces} className="btn-secondary text-xs h-7 px-2.5">
            <ExternalLink className="w-3 h-3" /> View Traces
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto bg-white p-4">
        <pre className="text-xs font-mono leading-5">
          <OutputLines output={result.output} />
        </pre>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function HttpTesting() {
  const { app } = useAppStore()
  const navigate = useNavigate()

  const [testList, setTestList] = useState<HurlTestListResponse | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [viewingRunIndex, setViewingRunIndex] = useState(0)
  const [editorHeight, setEditorHeight] = useState(300)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  const { addRun, runsForFile, variables, setVariables } = useTestRuns()
  const [showVars, setShowVars] = useState(false)
  const [spinVars, setSpinVars] = useState<VarEntry[]>([])

  useEffect(() => {
    getVars().then(setSpinVars).catch(() => {})
  }, [])

  const baseUrl = app?.listenAddr ?? ''
  const routes = useMemo(() => httpRoutes(app?.triggers ?? []), [app?.triggers])
  const hasUnsavedChanges = fileContent !== originalContent
  const canEdit = app?.allowMutations ?? false
  const fileRuns = useMemo(() => selectedPath ? runsForFile(selectedPath) : [], [selectedPath, runsForFile])
  const displayedRun = fileRuns[viewingRunIndex] ?? null

  // ── Fetch test list ──────────────────────────────
  const refreshList = useCallback(async () => {
    try {
      const data = await getHurlTests()
      setTestList(data)
      // Auto-expand all directories
      const dirs = new Set(data.files.map(f => f.dir === '.' ? '/' : f.dir))
      setExpandedDirs(dirs)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshList() }, [refreshList])

  // ── Select & load a file ────────────────────────
  const selectFile = useCallback(async (path: string) => {
    try {
      setError(null)
      setViewingRunIndex(0)
      const file = await getHurlFile(path)
      setSelectedPath(path)
      const content = file.content ?? ''
      setFileContent(content)
      setOriginalContent(content)
      setShowBuilder(false)
      const vars = content.match(/\{\{(\w+)\}\}/g)
      if (vars?.some(v => v !== '{{base_url}}')) setShowVars(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // ── Save file ───────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedPath) return
    setSaving(true)
    try {
      await saveHurlFile(selectedPath, fileContent)
      setOriginalContent(fileContent)
      setError(null)
      refreshList()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [selectedPath, fileContent, refreshList])

  // ── Run test ────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!selectedPath) return
    // Save first if there are unsaved changes
    if (hasUnsavedChanges) {
      try {
        await saveHurlFile(selectedPath, fileContent)
        setOriginalContent(fileContent)
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setRunning(true)
    setError(null)
    try {
      const vars: Record<string, string> = {}
      for (const v of variables) { if (v.key) vars[v.key] = v.value }
      const result = await runHurlTest(selectedPath, Object.keys(vars).length > 0 ? vars : undefined)
      addRun(selectedPath, result)
      setViewingRunIndex(0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [selectedPath, fileContent, hasUnsavedChanges, addRun, variables])

  // ── Save from builder ───────────────────────────
  const handleBuilderSave = useCallback(async (path: string, content: string) => {
    try {
      const result = await saveHurlFile(path, content)
      setShowBuilder(false)
      await refreshList()
      await selectFile(result.path)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [refreshList, selectFile])

  // ── Navigate to traces ──────────────────────────
  const viewTraces = useCallback(() => {
    if (!displayedRun) { navigate('/traces'); return }
    const r = displayedRun.result
    const buffer = 1000
    const params = new URLSearchParams({
      from: String(r.startTimeMs - buffer),
      to:   String(r.endTimeMs + buffer),
      label: selectedPath ?? 'test run',
    })
    navigate(`/traces?${params}`)
  }, [navigate, displayedRun, selectedPath])

  // ── Keyboard shortcut ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && selectedPath) {
        e.preventDefault()
        handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedPath) {
        e.preventDefault()
        handleRun()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedPath, handleSave, handleRun])

  // ── Drag-to-resize editor/results split ─────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - dragStartY.current
      setEditorHeight(Math.max(80, Math.min(800, dragStartH.current + delta)))
    }
    const onUp = () => { isDragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Filtered files ──────────────────────────────
  const filteredFiles = useMemo(() => {
    if (!testList || !filter) return testList?.files ?? []
    const q = filter.toLowerCase()
    return testList.files.filter(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    )
  }, [testList, filter])

  const groupedFiles = useMemo(() => groupByDir(filteredFiles), [filteredFiles])

  // ── Builder view ────────────────────────────────
  if (showBuilder) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-white">
        <NewTestBuilder
          routes={routes}
          defaultDir={testList?.defaultDir ?? 'tests'}
          onSave={handleBuilderSave}
          onCancel={() => setShowBuilder(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* ── Toolbar ────────────────────────────────── */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">HTTP Tests</h1>
          {testList && (
            <span className="badge badge-gray">{testList.files.length} file{testList.files.length !== 1 ? 's' : ''}</span>
          )}
          {testList && !testList.hurlInstalled && (
            <span className="badge badge-yellow">hurl not installed</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVars(v => !v)}
            className={`btn text-xs h-8 px-2.5 ${
              showVars || variables.some(v => v.key)
                ? 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'
                : 'btn-secondary'
            }`}
            title="Test variables — injected into {{variable}} placeholders"
          >
            <Braces className="w-3.5 h-3.5" />
            Variables
            {variables.filter(v => v.key).length > 0 && (
              <span className="ml-0.5 font-semibold">{variables.filter(v => v.key).length}</span>
            )}
          </button>
          {canEdit ? (
            <button onClick={() => setShowBuilder(true)} className="btn-primary text-xs h-8 px-3">
              <Plus className="w-3.5 h-3.5" /> New Test
            </button>
          ) : (
            <span
              className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5"
              title="Restart with --allow-edits to enable creating and editing tests"
            >
              <Lock className="w-3 h-3 shrink-0" />
              Read-only — pass <code className="font-mono">--allow-edits</code> to edit
            </span>
          )}
          <button onClick={() => refreshList()} className="btn-secondary text-xs h-8 px-2.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Variables panel */}
      {showVars && (
        <div className="border-b border-gray-200 bg-orange-50/40 px-6 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Braces className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-xs font-semibold text-gray-700">Test Variables</span>
              <span className="text-xs text-gray-400">
                — use <code className="font-mono text-orange-600 bg-orange-100 px-1 rounded">{'{{key}}'}</code> in .hurl files
              </span>
            </div>
            <button
              onClick={() => setVariables([...variables, { key: '', value: '' }])}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {/* Spin variable suggestions */}
          {(() => {
            const usedKeys = new Set(variables.map(v => v.key))
            const suggestions = spinVars.filter(sv => sv.declared && !usedKeys.has(sv.key))
            if (suggestions.length === 0) return null
            return (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide mr-0.5">Spin variables:</span>
                {suggestions.map(sv => (
                  <button
                    key={sv.key}
                    onClick={() => setVariables([...variables, { key: sv.key, value: sv.value }])}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                    title={sv.value ? `Value: ${sv.value} (from ${sv.source})` : `No default value (${sv.source}) — you'll need to provide one`}
                  >
                    <Plus className="w-2.5 h-2.5" />
                    {sv.key}
                    {sv.value
                      ? <Check className="w-2.5 h-2.5 text-emerald-500" />
                      : <span className="text-amber-500 text-[10px]">no value</span>
                    }
                  </button>
                ))}
              </div>
            )
          })()}

          {variables.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              {spinVars.some(sv => sv.declared)
                ? <>Click a Spin variable above, or add custom ones with <strong>+ Add</strong>.</>
                : <>No variables defined. Add variables and reference them as <code className="font-mono text-orange-600">{'{{key}}'}</code> in .hurl files.</>
              }
            </p>
          ) : (
            <div className="space-y-1.5">
              {variables.map((v, i) => {
                const spinMatch = spinVars.find(sv => sv.key === v.key && sv.declared)
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={`input-mono text-xs py-1 w-40 ${spinMatch ? 'border-emerald-300 bg-emerald-50/50' : ''}`}
                      placeholder="variable name"
                      value={v.key}
                      onChange={e => setVariables(variables.map((old, j) => j === i ? { ...old, key: e.target.value } : old))}
                    />
                    <span className="text-gray-400 text-xs">=</span>
                    <input
                      className="input-mono text-xs py-1 flex-1"
                      placeholder={spinMatch ? `from ${spinMatch.source}` : 'value'}
                      type={v.key.toLowerCase().includes('token') || v.key.toLowerCase().includes('secret') || v.key.toLowerCase().includes('password') || v.key.toLowerCase().includes('auth') ? 'password' : 'text'}
                      value={v.value}
                      onChange={e => setVariables(variables.map((old, j) => j === i ? { ...old, value: e.target.value } : old))}
                    />
                    {spinMatch && (
                      <span className="text-[10px] text-emerald-500 shrink-0" title={`Matches Spin variable from ${spinMatch.source}`}>
                        spin
                      </span>
                    )}
                    <button
                      onClick={() => setVariables(variables.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">
            <code className="font-mono">base_url</code> is injected automatically when your Spin app is running.
            Variables persist across refreshes.
          </p>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Hurl not installed banner */}
      {testList && !testList.hurlInstalled && (
        <div className="mx-4 mt-3 p-4 bg-amber-50 border border-amber-200 rounded-lg shrink-0">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800">Hurl is not installed</p>
              <p className="text-xs text-amber-700">
                Hurl is required to run HTTP tests. Install it from{' '}
                <a href="https://hurl.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">hurl.dev</a>
              </p>
              <pre className="text-xs font-mono bg-amber-100 px-2 py-1 rounded mt-1 text-amber-900">brew install hurl</pre>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* ── File sidebar ────────────────────────── */}
          <div className="w-56 shrink-0 border-r border-gray-200 flex flex-col bg-gray-50">
            {/* Search */}
            <div className="px-3 py-2 border-b border-gray-200 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input text-xs py-1 pl-8 w-full"
                  placeholder="Filter tests…"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                />
              </div>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto py-1">
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <FlaskConical className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 mb-3">No test files found</p>
                  {canEdit && (
                    <button onClick={() => setShowBuilder(true)} className="btn-primary text-xs h-7 px-3">
                      <Plus className="w-3 h-3" /> Create one
                    </button>
                  )}
                </div>
              ) : (
                Array.from(groupedFiles.entries()).map(([dir, files]) => (
                  <div key={dir}>
                    <button
                      onClick={() => setExpandedDirs(prev => {
                        const next = new Set(prev)
                        next.has(dir) ? next.delete(dir) : next.add(dir)
                        return next
                      })}
                      className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      {expandedDirs.has(dir)
                        ? <ChevronDown className="w-3 h-3 shrink-0" />
                        : <ChevronRight className="w-3 h-3 shrink-0" />
                      }
                      <FolderOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate">{dir}</span>
                    </button>
                    {expandedDirs.has(dir) && files.map(f => (
                      <button
                        key={f.path}
                        onClick={() => selectFile(f.path)}
                        className={`flex items-center gap-2 w-full text-left pl-8 pr-3 py-1.5 text-xs transition-colors ${
                          f.path === selectedPath
                            ? 'bg-spin-seagreen/10 text-spin-oxfordblue font-medium'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                      >
                        <HurlIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate font-mono">{f.name}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Main content ────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {!selectedPath ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4 px-8">
                <FlaskConical className="w-12 h-12 opacity-20" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-gray-500">HTTP Testing with Hurl</p>
                  <p className="text-xs text-gray-400 max-w-sm">
                    Create and run HTTP tests for your Spin app. Tests are powered by{' '}
                    <a href="https://hurl.dev" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline">Hurl</a>
                    {' '}and results link directly to traces.
                  </p>
                </div>
                <div className="flex gap-2">
                  {canEdit ? (
                    <button onClick={() => setShowBuilder(true)} className="btn-primary text-xs h-8 px-4">
                      <Plus className="w-3.5 h-3.5" /> New Test
                    </button>
                  ) : (
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                      <Lock className="w-3 h-3 shrink-0" />
                      Pass <code className="font-mono">--allow-edits</code> to create or edit tests
                    </span>
                  )}
                  {testList && testList.files.length > 0 && (
                    <button onClick={() => selectFile(testList.files[0].path)} className="btn-secondary text-xs h-8 px-4">
                      Open first test
                    </button>
                  )}
                </div>
                {baseUrl && (
                  <p className="text-xs text-gray-400 mt-2">
                    Spin app running at <code className="font-mono text-gray-500">{baseUrl}</code>
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Editor header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <HurlIcon className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-mono text-gray-700 truncate">{selectedPath}</span>
                    {hasUnsavedChanges && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        onClick={handleSave}
                        disabled={saving || !hasUnsavedChanges}
                        className="btn-secondary text-xs h-7 px-2.5"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                    )}
                    <button
                      onClick={handleRun}
                      disabled={running || !testList?.hurlInstalled}
                      className="btn-blue text-xs h-7 px-3"
                      title={!testList?.hurlInstalled ? 'Install hurl first' : 'Run test (⌘Enter)'}
                    >
                      {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Run
                    </button>
                  </div>
                </div>

                {/* Editor + results split */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  {/* Highlighted editor */}
                  <div
                    className="overflow-hidden flex flex-col shrink-0"
                    style={displayedRun ? { height: editorHeight } : { flex: 1 }}
                  >
                    <HurlEditor
                      value={fileContent}
                      onChange={setFileContent}
                      readOnly={!canEdit}
                      placeholder="# Write your Hurl test here\n# Tip: use {{base_url}} for the Spin app address\n\nGET {{base_url}}/\nHTTP 200"
                    />
                  </div>

                  {/* Resize handle */}
                  {displayedRun && (
                    <div
                      className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200 active:bg-blue-300 transition-colors flex items-center justify-center group"
                      onMouseDown={e => {
                        isDragging.current = true
                        dragStartY.current = e.clientY
                        dragStartH.current = editorHeight
                        document.body.style.cursor = 'row-resize'
                        e.preventDefault()
                      }}
                    >
                      <div className="w-10 h-0.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
                    </div>
                  )}

                  {/* Run results */}
                  {displayedRun && (
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                      {/* Run history bar */}
                      {fileRuns.length > 1 && (
                        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0 overflow-x-auto">
                          <Clock className="w-3 h-3 text-gray-400 shrink-0" />
                          <span className="text-xs text-gray-400 shrink-0 mr-0.5">Runs:</span>
                          {fileRuns.map((run, i) => {
                            const time = new Date(run.timestamp).toLocaleTimeString('en-US', {
                              hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
                            })
                            const isActive = i === viewingRunIndex
                            return (
                              <button
                                key={run.id}
                                onClick={() => setViewingRunIndex(i)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors shrink-0 ${
                                  isActive
                                    ? run.result.success
                                      ? 'bg-green-100 text-green-800 ring-1 ring-green-300'
                                      : 'bg-red-100 text-red-800 ring-1 ring-red-300'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                {run.result.success
                                  ? <Check className="w-3 h-3 text-green-600" />
                                  : <X className="w-3 h-3 text-red-500" />
                                }
                                {time}
                                <span className="text-gray-400">{fmtDuration(run.result.durationMs)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <RunOutput result={displayedRun.result} onViewTraces={viewTraces} />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
