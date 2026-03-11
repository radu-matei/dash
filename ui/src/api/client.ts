const BASE = ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? res.statusText)
  }
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

export interface ComponentInfo {
  id: string
  source: string
  allowedOutboundHosts?: string[]
  keyValueStores?: string[]
  sqliteDatabases?: string[]
  variables?: Record<string, string>
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
}

export const getApp = () => get<AppInfo>('/api/app')

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
}

export const getTraces = () => get<Span[]>('/api/traces')

// ── Variables ─────────────────────────────────────────────────────────────────

export interface VarEntry {
  key: string
  value: string
  source: 'spin.toml' | '.env'
  secret: boolean
}

export const getVars = () => get<VarEntry[]>('/api/vars')

// ── SQLite ────────────────────────────────────────────────────────────────────

export const getSQLiteTables = () => get<string[]>('/api/sqlite/tables')

export interface QueryResult {
  columns: string[]
  rows: (string | number | null)[][]
}

export const querySQLite = (sql: string) =>
  post<QueryResult>('/api/sqlite/query', { sql })

export const execSQLite = (sql: string) =>
  post<QueryResult>('/api/sqlite/exec', { sql })

// ── OTel metrics ──────────────────────────────────────────────────────────────

export interface MetricPoint {
  timestamp: string
  value: number
  attrs?: Record<string, string>
}

export interface MetricSeries {
  name: string
  description: string
  unit: string
  kind: 'counter' | 'gauge' | 'histogram'
  points: MetricPoint[]
}

export const getOtelMetrics = () => get<Record<string, MetricSeries>>('/api/otel-metrics')

// ── KV Store ──────────────────────────────────────────────────────────────────

export interface KVEntry {
  store: string
  key: string
  value: string
}

export const getKVEntries = (store?: string) =>
  get<KVEntry[]>(`/api/kv${store ? `?store=${encodeURIComponent(store)}` : ''}`)

export const upsertKV = (entry: KVEntry) => post<void>('/api/kv', entry)

export const deleteKV = (store: string, key: string) =>
  del(`/api/kv/${encodeURIComponent(store)}/${encodeURIComponent(key)}`)
