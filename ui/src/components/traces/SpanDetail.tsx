import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { SpanNode } from './types'
import { fmtTime, fmtDuration, fmtNs, stripAnsi, KEY_ATTRS, SKIP_ATTRS } from './traceUtils'

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }
  return (
    <button
      onClick={e => { e.stopPropagation(); copy() }}
      className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors"
      title={label ? `Copy ${label}` : 'Copy'}
    >
      {copied
        ? <Check className="w-3 h-3 text-green-500" />
        : <Copy className="w-3 h-3" />
      }
    </button>
  )
}

export default function SpanDetail({ node, colorMap, effectiveColor, effectiveComponent, onClose }: { node: SpanNode; colorMap: Map<string, string>; effectiveColor?: string; effectiveComponent?: string; onClose: () => void }) {
  const { span } = node
  const isError = span.status === 'ERROR'
  const color = effectiveColor ?? colorMap.get(span.component ?? '') ?? '#6b7280'
  const displayComponent = effectiveComponent ?? span.component
  const attrs = span.attrs ?? {}
  const keyAttrs = KEY_ATTRS.filter(k => attrs[k])
  const otherAttrs = Object.entries(attrs).filter(([k]) => !KEY_ATTRS.includes(k) && !SKIP_ATTRS.has(k))
  const httpStatus = attrs['http.response.status_code'] ?? attrs['http.status_code']
  const isStatusError = httpStatus && Number(httpStatus) >= 400
  const busyNs = attrs['busy_ns'] ? Number(attrs['busy_ns']) : null
  const idleNs = attrs['idle_ns'] ? Number(attrs['idle_ns']) : null
  const events = span.events ?? []

  return (
    <div className="border-b-2 border-blue-100 bg-blue-50/30 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-blue-50/60 border-b border-blue-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isError ? '#dc2626' : color }} />
          <span className="font-semibold text-gray-900 font-mono truncate">{span.name}</span>
          {isError && <span className="badge badge-red badge-sm rounded-full shrink-0">ERROR</span>}
          {httpStatus && (
            <span className={`badge badge-sm rounded-full shrink-0 font-mono ${isStatusError ? 'badge-red' : 'badge-gray'}`}>
              HTTP {httpStatus}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-b border-gray-100 text-gray-500">
        <span>Start: <strong className="text-gray-900">{fmtTime(new Date(span.startTime).getTime())}</strong></span>
        <span>Duration: <strong className="text-gray-900">{fmtDuration(span.durationMs)}</strong></span>
        {displayComponent && <span>Component: <strong className="text-gray-900">{displayComponent}</strong></span>}
        <span className="font-mono text-gray-400 inline-flex items-center gap-1">span: {span.spanId.slice(0, 16)}… <CopyButton text={span.spanId} label="span ID" /></span>
        {span.parentId && <span className="font-mono text-gray-400 inline-flex items-center gap-1">parent: {span.parentId.slice(0, 16)}… <CopyButton text={span.parentId} label="parent ID" /></span>}
      </div>

      {/* Key attrs */}
      {keyAttrs.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 grid grid-cols-[minmax(160px,auto)_1fr] gap-x-4 gap-y-1">
          {keyAttrs.map(k => (
            <>
              <span key={k + 'k'} className="text-gray-500 font-mono whitespace-nowrap">{k}</span>
              <span key={k + 'v'} className={`font-mono break-all ${
                (k === 'http.status_code' || k === 'http.response.status_code') && Number(attrs[k]) >= 400
                  ? 'text-red-700 font-semibold'
                  : 'text-gray-800'
              }`}>{attrs[k]}</span>
            </>
          ))}
        </div>
      )}

      {/* All other attrs — shown by default, no collapsible */}
      {otherAttrs.length > 0 && (
        <div className="px-4 py-2 grid grid-cols-[minmax(160px,auto)_1fr] gap-x-4 gap-y-1">
          {otherAttrs.map(([k, v]) => (
            <>
              <span key={k + 'k'} className="text-gray-400 font-mono whitespace-nowrap">{k}</span>
              <span key={k + 'v'} className="font-mono break-all text-gray-700">{v}</span>
            </>
          ))}
        </div>
      )}

      {Object.keys(attrs).length > 0 && (
        <div className="px-4 py-1.5 border-b border-gray-100">
          <CopyButton text={JSON.stringify(attrs, null, 2)} label="attributes as JSON" />
        </div>
      )}

      {Object.keys(attrs).length === 0 && events.length === 0 && (
        <p className="px-4 py-3 text-gray-400 italic">No attributes recorded for this span.</p>
      )}

      {/* CPU busy / idle breakdown */}
      {busyNs !== null && idleNs !== null && (
        <div className="px-4 py-2 border-t border-gray-100 flex gap-6 text-xs">
          <span className="text-gray-500">CPU busy: <strong className="text-gray-800 font-mono">{fmtNs(busyNs)}</strong></span>
          <span className="text-gray-500">Waiting: <strong className="text-gray-800 font-mono">{fmtNs(idleNs)}</strong></span>
        </div>
      )}

      {/* Span events (embedded logs from tracing::event!) */}
      {events.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Events ({events.length})</p>
          <div className="space-y-1.5">
            {events.map((ev, i) => {
              const appLog = ev.attrs?.['app_log']
              const msg = appLog ? stripAnsi(appLog).trim() : (ev.attrs?.['event'] ?? ev.name)
              const level = ev.attrs?.['level']
              const levelColor = level === 'ERROR' ? 'text-red-600' : level === 'WARN' ? 'text-amber-600' : 'text-gray-500'
              return (
                <div key={i} className="flex gap-2 text-xs font-mono">
                  <span className="text-gray-300 shrink-0 tabular-nums">
                    {new Date(ev.timeMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {level && <span className={`shrink-0 font-semibold ${levelColor}`}>{level}</span>}
                  <span className="text-gray-700 break-all whitespace-pre-wrap">{msg}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
