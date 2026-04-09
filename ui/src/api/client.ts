const BASE = ''

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined)
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
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as T
}

// ── Status ────────────────────────────────────────────────────────────────────

export type SpinStatus = 'starting' | 'running' | 'stopped' | 'error' | 'building' | 'restarting'

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
  /** True when route = { private = true } — internal-only, no public endpoint. */
  private?: boolean
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
  aiModels?: string[]
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
  /** Keys of all variables declared in [variables] in spin.toml. */
  variableKeys: string[]
  listenAddr?: string
  /** True only when the dashboard was started with --allow-edits. */
  allowMutations: boolean
  /** True when the app has KV stores and the explorer component was injected. */
  hasKV: boolean
}

export const getApp = (signal?: AbortSignal) => get<AppInfo>('/api/app', signal)

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface LogLine {
  stream: 'stdout' | 'stderr' | 'system' | 'component'
  /** set when stream === 'component' */
  component?: string
  /** 'stdout' | 'stderr' when stream === 'component' */
  subStream?: string
  line: string
  /** injected by the log store — ms since epoch when the line arrived */
  receivedAt?: number
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
  declared: boolean
}

export const getVars = () => get<VarEntry[]>('/api/vars')

// ── OTel metrics ──────────────────────────────────────────────────────────────

export interface SpanEvent {
  timeMs: number
  name: string
  attrs?: Record<string, string>
}

export interface HistogramBuckets {
  boundaries: number[]
  counts: number[]
  sum: number
  count: number
}

export interface MetricSeries {
  name: string
  description: string
  unit: string
  kind: 'counter' | 'gauge' | 'histogram'
  points: MetricPoint[]
  buckets?: HistogramBuckets
}

export const getOtelMetrics = (signal?: AbortSignal) => get<Record<string, MetricSeries>>('/api/otel-metrics', signal)

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface MutationResult {
  message: string
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface TemplateParam {
  id: string
  prompt: string
  default?: string
  pattern?: string
  allowed_values?: string[]
  /** True for the special "http-path" parameter — the UI shows the
   *  route input + private-endpoint toggle instead of a plain text field. */
  is_http_path?: boolean
}

export interface TemplateInfo {
  id: string
  description: string
  parameters: TemplateParam[]
}

/** Fetch all installed Spin templates with their parameter definitions.
 *  Returns an empty array if the templates directory cannot be found. */
export const fetchTemplates = () => get<TemplateInfo[]>('/api/templates')

/** Run `spin add -t template name --value key=value …` in the app directory.
 *  `values` maps template parameter IDs to their values.
 *  Pass `privateEndpoint = true` for the `http-path` parameter to generate
 *  `route = { private = true }` instead of a public route. */
export const addComponent = (
  template: string,
  name: string,
  values: Record<string, string>,
  privateEndpoint?: boolean,
) =>
  post<MutationResult>('/api/add-component', {
    template,
    name,
    values,
    ...(privateEndpoint ? { private: true } : {}),
  })

/** Add a new variable to [variables] in spin.toml and wire it to the given
 *  components via [component.<id>.variables]. Restarts Spin on success. */
export const addVariable = (
  name: string,
  defaultValue: string,
  required: boolean,
  secret: boolean,
  componentIds: string[],
) => post<MutationResult>('/api/add-variable', { name, defaultValue, required, secret, componentIds })

/** Add a service binding to a component in spin.toml and restart Spin.
 *  type: 'kv' | 'sqlite' | 'ai' | 'outbound-host' */
export const addBinding = (
  componentId: string,
  type: 'kv' | 'sqlite' | 'ai' | 'outbound-host',
  storeName: string,
) => post<MutationResult>('/api/add-binding', { componentId, type, storeName })

/** Wire an existing [variables] entry to a component's [component.<id>.variables]. */
export const addComponentVariable = (componentId: string, varName: string) =>
  post<MutationResult>('/api/add-component-variable', { componentId, varName })

/** Remove a KV or SQLite binding from a component in spin.toml. */
export const removeBinding = (componentId: string, type: 'kv' | 'sqlite', storeName: string) =>
  post<MutationResult>('/api/remove-binding', { componentId, type, storeName })

/** Restart the Spin child process without touching spin.toml. */
export const restartSpin = () => post<MutationResult>('/api/restart', {})

/** Run `spin build` (streaming to the Logs tab) then restart the Spin process. */
export const buildAndRestart = () => post<MutationResult>('/api/build-restart', {})

// ── Hurl HTTP testing ────────────────────────────────────────────────────────

export interface HurlTestFile {
  name: string
  path: string
  dir: string
  content?: string
  lastRun?: HurlRunResult
}

export interface HurlTestListResponse {
  files: HurlTestFile[]
  hurlInstalled: boolean
  defaultDir: string
}

export interface HurlRunResult {
  success: boolean
  output: string
  durationMs: number
  startTimeMs: number
  endTimeMs: number
  file: string
  exitCode: number
}

export const getHurlTests = () => get<HurlTestListResponse>('/api/hurl-tests')

export const getHurlFile = (path: string) =>
  get<HurlTestFile>(`/api/hurl-file?path=${encodeURIComponent(path)}`)

export const saveHurlFile = (path: string, content: string) =>
  post<MutationResult & { path: string }>('/api/hurl-file', { path, content })

export const runHurlTest = (path: string, variables?: Record<string, string>) =>
  post<HurlRunResult>('/api/hurl-run', { path, variables })

export const runAllHurlTests = (paths?: string[], variables?: Record<string, string>) =>
  post<{ results: HurlRunResult[] }>('/api/hurl-run-all', { paths, variables })

export const deleteHurlFile = (path: string) =>
  post<MutationResult>('/api/hurl-delete', { path })

// ── KV Explorer ──────────────────────────────────────────────────────────────

export interface KVKeysResponse {
  store: string
  keys: string[]
}

/** List all KV store names from the app config. */
export const getKVStores = () => get<string[]>('/api/kv/stores')

/** List all keys in a store. */
export const getKVKeys = (store: string) =>
  get<KVKeysResponse>(`/api/kv/stores/${encodeURIComponent(store)}/keys`)

/** Get the raw bytes of a key value. Returns an ArrayBuffer for binary safety. */
export async function getKVKeyRaw(store: string, key: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/kv/stores/${encodeURIComponent(store)}/keys/${encodeURIComponent(key)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.arrayBuffer()
}

/** Set (upsert) a key-value pair. Value is sent as raw bytes. */
export async function setKVKey(store: string, key: string, value: string | ArrayBuffer): Promise<{ ok: boolean }> {
  const body = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const res = await fetch(`/api/kv/stores/${encodeURIComponent(store)}/keys/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json()
}

/** Delete a key from a store. */
export async function deleteKVKey(store: string, key: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/kv/stores/${encodeURIComponent(store)}/keys/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return { ok: true }
}

