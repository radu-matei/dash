import { useMemo, useState } from 'react'
import { FlaskConical, Minus, Plus, Save, Trash2 } from 'lucide-react'
import ResizablePanel from '../ResizablePanel'
import HurlEditor from './HurlEditor'
import {
  type Assertion, type HttpMethod, type TestEntry,
  ASSERTION_TYPES, HTTP_METHODS, STATUS_CODES,
  emptyEntry, generateHurl,
} from './types'

// ─── Assertion builder row ──────────────────────────────────────────────────

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

// ─── Header row ─────────────────────────────────────────────────────────────

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

// ─── Request card ───────────────────────────────────────────────────────────

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

// ─── New Test Builder ───────────────────────────────────────────────────────

export default function NewTestBuilder({
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

      <ResizablePanel
        storageKey="hurl-builder-preview"
        defaultWidth={288}
        minWidth={200}
        maxWidth={480}
        side="right"
        panel={
          <>
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
          </>
        }
      >
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
      </ResizablePanel>
    </div>
  )
}
