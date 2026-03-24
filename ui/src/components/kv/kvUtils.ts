// ─── Types ───────────────────────────────────────────────────────────────────

export type ValueType = 'json' | 'string' | 'binary'

export interface KVKeyEntry {
  key: string
  value: string | null      // null = not yet fetched. Text representation.
  rawBytes: ArrayBuffer | null // original raw bytes from the API
  type: ValueType | null
  size: number | null
}

// ─── Type Detection ──────────────────────────────────────────────────────────

/** Check if bytes are valid UTF-8 text. */
function isText(bytes: ArrayBuffer): boolean {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

export function detectValueType(bytes: ArrayBuffer): ValueType {
  if (!isText(bytes)) return 'binary'
  const text = new TextDecoder().decode(bytes)
  try {
    JSON.parse(text)
    return 'json'
  } catch { /* not JSON */ }
  return 'string'
}

// ─── Size Formatting ─────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Entry Enrichment ────────────────────────────────────────────────────────

/** Create a KVKeyEntry from raw bytes returned by the API. */
export function enrichKeyEntry(key: string, rawBytes: ArrayBuffer): KVKeyEntry {
  const type = detectValueType(rawBytes)
  const size = rawBytes.byteLength
  const value = type === 'binary'
    ? `[binary data, ${formatSize(size)}]`
    : new TextDecoder().decode(rawBytes)
  return { key, value, rawBytes, type, size }
}

// ─── Badge Helpers ───────────────────────────────────────────────────────────

export const TYPE_BADGE_CLASS: Record<ValueType, string> = {
  json: 'badge badge-blue',
  string: 'badge badge-gray',
  binary: 'badge badge-purple',
}

export const TYPE_LABEL: Record<ValueType, string> = {
  json: 'JSON',
  string: 'STR',
  binary: 'BIN',
}
