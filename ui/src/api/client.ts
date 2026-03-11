const BASE = ''

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json()
}

// ── Status ────────────────────────────────────────────────────────────────────

export type SpinStatus = 'starting' | 'running' | 'stopped' | 'error'

export interface AppStatus {
  status: SpinStatus
  error: string
}

export const getStatus = () => get<AppStatus>('/api/status')

// ── App structure ─────────────────────────────────────────────────────────────

export interface TriggerInfo {
  type: string
  route?: string
  channel?: string
  address?: string
  component: string
}

export interface FileMount {
  source: string
  destination?: string
}

export interface BuildInfo {
  command?: string
  workdir?: string
  watch?: string[]
}

export interface ComponentInfo {
  id: string
  source: string
  sourceDigest?: string
  sourceSize?: number
  allowedOutboundHosts?: string[]
  keyValueStores?: string[]
  sqliteDatabases?: string[]
  variables?: Record<string, string>
  files?: FileMount[]
  build?: BuildInfo
  triggers?: TriggerInfo[]
}

export interface AppInfo {
  name: string
  description: string
  status: SpinStatus
  error: string
  components: ComponentInfo[]
  triggers: TriggerInfo[]
  varCount: number
  listenAddr?: string
}

export const getApp = (signal?: AbortSignal) => get<AppInfo>('/api/app', signal)

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface LogLine {
  stream: 'stdout' | 'stderr' | 'system'
  line: string
}

export function subscribeToLogs(
  onMessage: (line: LogLine) => void,
  onError?: (e: Event) => void,
): EventSource {
  const es = new EventSource('/api/logs')
  es.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data) as LogLine) } catch { /* ignore */ }
  }
  if (onError) es.onerror = onError
  return es
}

// ── Traces ────────────────────────────────────────────────────────────────────

export interface Span {
  traceId: string
  spanId: string
  parentId?: string
  name: string
  component?: string
  startTime: string
  durationMs: number
  status: 'OK' | 'ERROR'
  attrs?: Record<string, string>
  events?: SpanEvent[]
}

export interface MetricPoint {
  timestamp: string
  value: number
  attrs?: Record<string, string>
}

export const getTraces = (signal?: AbortSignal) => get<Span[]>('/api/traces', signal)

// ── Variables ─────────────────────────────────────────────────────────────────

export interface VarEntry {
  key: string
  value: string
  source: 'spin.toml' | '.env' | 'SPIN_VARIABLE' | '--variable'
  secret: boolean
}

export const getVars = () => get<VarEntry[]>('/api/vars')

// ── OTel metrics ──────────────────────────────────────────────────────────────

export interface SpanEvent {
  timeMs: number
  name: string
  attrs?: Record<string, string>
}

export interface MetricSeries {
  name: string
  description: string
  unit: string
  kind: 'counter' | 'gauge' | 'histogram'
  points: MetricPoint[]
}

export const getOtelMetrics = (signal?: AbortSignal) => get<Record<string, MetricSeries>>('/api/otel-metrics', signal)

