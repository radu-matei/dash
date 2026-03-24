import type { TriggerInfo } from '../../api/client'

// ─── Constants ───────────────────────────────────────────────────────────────

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = typeof HTTP_METHODS[number]

export const STATUS_CODES = [
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

export const ASSERTION_TYPES = [
  { value: 'jsonpath', label: 'JSONPath', placeholder: '$.status' },
  { value: 'header', label: 'Header', placeholder: 'Content-Type' },
  { value: 'body', label: 'Body contains', placeholder: '' },
  { value: 'duration', label: 'Duration <', placeholder: '1000' },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Assertion {
  type: string
  selector: string
  predicate: string
  value: string
}

export interface TestEntry {
  method: HttpMethod
  url: string
  headers: { key: string; value: string }[]
  body: string
  expectedStatus: string
  assertions: Assertion[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function groupByDir<T extends { dir: string }>(files: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const f of files) {
    const dir = f.dir === '.' ? '/' : f.dir
    const arr = map.get(dir) ?? []
    arr.push(f)
    map.set(dir, arr)
  }
  return map
}

export function httpRoutes(triggers: TriggerInfo[]): { route: string; component: string }[] {
  return triggers
    .filter(t => t.type === 'http' && t.route && !t.private)
    .map(t => ({ route: t.route!, component: t.component }))
}

export function emptyEntry(): TestEntry {
  return {
    method: 'GET',
    url: '{{base_url}}/',
    headers: [],
    body: '',
    expectedStatus: '200',
    assertions: [],
  }
}

export function generateHurl(entries: TestEntry[]): string {
  const lines: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (i > 0) lines.push('')

    lines.push(`${e.method} ${e.url}`)

    for (const h of e.headers) {
      if (h.key && h.value) lines.push(`${h.key}: ${h.value}`)
    }

    if (e.body.trim() && ['POST', 'PUT', 'PATCH'].includes(e.method)) {
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
