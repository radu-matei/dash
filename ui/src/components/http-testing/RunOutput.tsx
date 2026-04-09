import { useMemo, useState } from 'react'
import {
  AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink, FileText, X,
} from 'lucide-react'
import type { HurlRunResult } from '../../api/client'
import { parseHurlOutput, redactSecrets, type ParsedEntry } from './hurl-parser'
import { fmtDuration } from './types'

// ─── Raw output helpers (fallback) ──────────────────────────────────────────

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

function RawOutputLines({ output }: { output: string }) {
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
    <pre className="text-xs font-mono leading-5 p-4">
      {rendered.map(r => (
        <div key={r.key} className={r.cls}>{r.text || '\u00A0'}</div>
      ))}
    </pre>
  )
}

// ─── Structured entry view ──────────────────────────────────────────────────

function CollapsibleSection({ label, count, children, defaultOpen = false }: {
  label: string
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-0.5"
      >
        {open
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />
        }
        <span>{label}</span>
        {count !== undefined && (
          <span className="text-gray-400">({count})</span>
        )}
      </button>
      {open && <div className="ml-4 mt-1">{children}</div>}
    </div>
  )
}

function HeadersTable({ headers }: { headers: [string, string][] }) {
  if (headers.length === 0) return <p className="text-xs text-gray-400 italic">No headers</p>
  return (
    <div className="space-y-0.5">
      {headers.map(([k, v], i) => (
        <div key={i} className="flex gap-2 text-xs font-mono">
          <span className="text-teal-600 shrink-0">{k}:</span>
          <span className="text-gray-600 break-all">{v}</span>
        </div>
      ))}
    </div>
  )
}

function prettyBody(body: string): string {
  if (!body) return ''
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function EntryCard({ entry }: { entry: ParsedEntry }) {
  const statusOk = entry.response.status >= 200 && entry.response.status < 400
  const allAssertsPassed = entry.asserts.length === 0 || entry.asserts.every(a => a.passed)
  const entryPassed = statusOk && allAssertsPassed

  return (
    <div className={`rounded-lg border ${entryPassed ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}`}>
      {/* Entry header */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {entryPassed
          ? <Check className="w-4 h-4 text-green-600 shrink-0" />
          : <X className="w-4 h-4 text-red-500 shrink-0" />
        }
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-gray-500">Entry {entry.index}</span>
          <span className="font-mono text-sm font-bold text-emerald-700">{entry.request.method}</span>
          <span className="font-mono text-sm text-blue-600 truncate">{entry.request.url}</span>
        </div>
        <span className="text-xs text-gray-400 mx-1">→</span>
        <span className={`font-mono text-sm font-bold ${statusOk ? 'text-green-700' : 'text-red-600'}`}>
          {entry.response.status}
        </span>
        {entry.response.statusText && (
          <span className="text-xs text-gray-500">{entry.response.statusText}</span>
        )}
      </div>

      {/* Collapsible details */}
      <div className="px-4 pb-3 space-y-1">
        <CollapsibleSection label="Request headers" count={entry.request.headers.length}>
          <HeadersTable headers={entry.request.headers} />
        </CollapsibleSection>

        <CollapsibleSection label="Response headers" count={entry.response.headers.length}>
          <HeadersTable headers={entry.response.headers} />
        </CollapsibleSection>

        {entry.response.body && (
          <CollapsibleSection label="Response body">
            <pre className="text-xs font-mono text-gray-700 bg-white/60 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
              {prettyBody(entry.response.body)}
            </pre>
          </CollapsibleSection>
        )}

        {/* Assertions */}
        {entry.asserts.length > 0 && (
          <div className="pt-1">
            <span className="text-xs font-semibold text-gray-600">Assertions</span>
            <div className="mt-1 space-y-0.5">
              {entry.asserts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {a.passed
                    ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                    : <X className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  }
                  <span className={`font-mono ${a.passed ? 'text-gray-600' : 'text-red-700'}`}>
                    {a.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main RunOutput component ───────────────────────────────────────────────

export default function RunOutput({ result, onViewTraces, variables }: {
  result: HurlRunResult
  onViewTraces: () => void
  variables?: { key: string; value: string }[]
}) {
  const [showRaw, setShowRaw] = useState(false)

  // Redact secret variable values from output before parsing or displaying
  const redactedOutput = useMemo(() => {
    if (!variables || variables.length === 0) return result.output
    return redactSecrets(result.output, variables)
  }, [result.output, variables])

  const parsed = useMemo(() => parseHurlOutput(redactedOutput), [redactedOutput])

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
          {parsed && (
            <span className="text-xs text-gray-500">
              {parsed.entries.length} {parsed.entries.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRaw(v => !v)}
            className={`btn-secondary text-xs h-7 px-2.5 ${showRaw ? 'bg-gray-200' : ''}`}
            title={showRaw ? 'Show structured view' : 'Show raw output'}
          >
            <FileText className="w-3 h-3" />
            {showRaw ? 'Structured' : 'Raw'}
          </button>
          <button onClick={onViewTraces} className="btn-secondary text-xs h-7 px-2.5">
            <ExternalLink className="w-3 h-3" /> View Traces
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-white">
        {showRaw || !parsed ? (
          <RawOutputLines output={result.output} />
        ) : (
          <div className="p-4 space-y-3">
            {parsed.entries.map(entry => (
              <EntryCard key={entry.index} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
