import type { Span, AppInfo } from '../../api/client'
import { componentHex } from '../../componentColors'
import type { TraceGroup, SpanNode } from './types'

// ─── Color palette ────────────────────────────────────────────────────────────

export function buildColorMap(spans: Span[]): Map<string, string> {
  const EXEC_PREFIX = 'execute_wasm_component '
  const set = new Set<string>()
  for (const s of spans) {
    if (s.component) set.add(s.component)
    if (s.name?.startsWith(EXEC_PREFIX)) set.add(s.name.slice(EXEC_PREFIX.length).trim())
  }
  const m = new Map<string, string>()
  for (const c of set) m.set(c, componentHex(c))
  return m
}

// ─── Trace grouping ───────────────────────────────────────────────────────────

// Build route→component map from app triggers (e.g. "/agent/..." → "ai-router")
export function buildRouteMap(app: AppInfo | null): Map<string, string> {
  const m = new Map<string, string>()
  if (!app) return m
  for (const t of app.triggers) {
    if (t.route && t.component) m.set(t.route, t.component)
  }
  return m
}

export function groupTraces(spans: Span[], routeMap: Map<string, string>): TraceGroup[] {
  const map = new Map<string, Span[]>()
  for (const s of spans) {
    const arr = map.get(s.traceId) ?? []; arr.push(s); map.set(s.traceId, arr)
  }
  return Array.from(map.entries()).map(([traceId, ss]) => {
    const sorted = [...ss].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    const root = sorted.find(s => !s.parentId) ?? sorted[0]
    const startMs = new Date(sorted[0].startTime).getTime()
    const endMs = Math.max(...sorted.map(s => new Date(s.startTime).getTime() + s.durationMs))
    const durationMs = Math.max(endMs - startMs, root?.durationMs ?? 0)
    const rootAttrs = root?.attrs ?? {}
    // Spin doesn't set component_id on trace spans (only on metrics).
    // Priority: http.route→manifest lookup, then "execute_wasm_component {id}" span name,
    // then any non-generic component value, then resource service.name.
    const httpRoute = rootAttrs['http.route']
    const execSpan = sorted.find(s => s.name?.startsWith('execute_wasm_component '))
    const execComponent = execSpan ? execSpan.name.slice('execute_wasm_component '.length).trim() : null
    const component =
      (httpRoute && routeMap.get(httpRoute)) ??
      execComponent ??
      sorted.find(s => s.component && s.component !== 'spin')?.component ??
      root?.component ?? ''
    const EXEC_PREFIX = 'execute_wasm_component '
    const components = new Set<string>()
    for (const s of sorted) {
      if (s.component && s.component !== 'spin') components.add(s.component)
      if (s.name?.startsWith(EXEC_PREFIX)) components.add(s.name.slice(EXEC_PREFIX.length).trim())
    }
    if (component) components.add(component)

    return {
      traceId, rootName: root?.name ?? traceId.slice(0, 8),
      component,
      components,
      startMs, endMs: startMs + durationMs, durationMs,
      spanCount: ss.length,
      hasErrors: ss.some(s => s.status === 'ERROR'),
      spans: sorted,
      httpMethod: rootAttrs['http.method'] ?? rootAttrs['http.request.method'],
      httpStatus: rootAttrs['http.response.status_code'] ?? rootAttrs['http.status_code'],
      httpPath: httpPathFromAttrs(rootAttrs),
    }
  }).sort((a, b) => b.startMs - a.startMs)
}

// ─── Span tree ────────────────────────────────────────────────────────────────

export function buildTree(spans: Span[]): SpanNode[] {
  const map = new Map<string, SpanNode>()
  for (const s of spans) map.set(s.spanId, { span: s, children: [], depth: 0 })
  const roots: SpanNode[] = []
  for (const node of map.values()) {
    if (node.span.parentId && map.has(node.span.parentId)) map.get(node.span.parentId)!.children.push(node)
    else roots.push(node)
  }
  const setDepth = (n: SpanNode, d: number) => {
    n.depth = d
    n.children.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime())
    n.children.forEach(c => setDepth(c, d + 1))
  }
  roots.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime())
  roots.forEach(r => setDepth(r, 0))
  return roots
}

export function flattenTree(nodes: SpanNode[], collapsed?: Set<string>): SpanNode[] {
  const out: SpanNode[] = []
  const visit = (n: SpanNode) => {
    out.push(n)
    if (!collapsed?.has(n.span.spanId)) n.children.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

export const EXEC_WASM_PREFIX = 'execute_wasm_component '

export function spanComponent(span: Span): string {
  if (span.name?.startsWith(EXEC_WASM_PREFIX)) return span.name.slice(EXEC_WASM_PREFIX.length).trim()
  return span.component ?? ''
}

/** Count all descendants (children, grandchildren, etc.) of a node. */
export function descendantCount(node: SpanNode): number {
  let count = 0
  const visit = (n: SpanNode) => { count += n.children.length; n.children.forEach(visit) }
  visit(node)
  return count
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    // @ts-expect-error valid
    fractionalSecondDigits: 3,
  })
}

export function fmtNs(ns: number): string {
  if (ns < 1_000) return `${ns}ns`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)}μs`
  return `${(ns / 1_000_000).toFixed(2)}ms`
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Well-known OTel attrs to highlight prominently in span detail
export const KEY_ATTRS = [
  'http.method', 'http.url', 'http.route', 'http.status_code',
  'rpc.method', 'db.statement', 'db.system',
  'error.message', 'exception.message', 'exception.type',
  'span.kind', 'key', 'command',
]
// Attrs that are low-signal noise for end users
export const SKIP_ATTRS = new Set(['busy_ns', 'idle_ns', 'code.filepath', 'code.lineno', 'code.namespace', 'otel.scope.name'])

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g
export const stripAnsi = (s: string) => s.replace(ANSI_RE, '')

// ─── HTTP attribute extraction ────────────────────────────────────────────────

/**
 * Extract the request path from a span's attrs. Tries common OTel conventions
 * in priority order. Returns undefined when no path attribute is present.
 * For full URLs, parses out just the path+query to keep the list row compact.
 */
export function httpPathFromAttrs(attrs: Record<string, string>): string | undefined {
  const direct = attrs['url.path'] ?? attrs['http.target'] ?? attrs['http.route']
  if (direct) return direct
  const full = attrs['url.full'] ?? attrs['http.url']
  if (full) {
    try {
      const u = new URL(full)
      return u.pathname + u.search
    } catch {
      return full
    }
  }
  return undefined
}

/**
 * Extract a displayable URL or host+path from a span's attrs. Used by the
 * waterfall to label outbound HTTP client spans. Prefers the full URL so
 * users can see the destination host; falls back to path-only.
 */
export function httpUrlFromAttrs(attrs: Record<string, string>): string | undefined {
  const full = attrs['url.full'] ?? attrs['http.url']
  if (full) return full
  const host = attrs['server.address'] ?? attrs['net.peer.name']
  const path = attrs['url.path'] ?? attrs['http.target'] ?? attrs['http.route']
  if (host && path) return `${host}${path}`
  if (host) return host
  return path
}
