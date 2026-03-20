import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Database, FileCode2, Key, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import {
  getKVStores, getKVKeys, getKVKey, setKVKey, deleteKVKey,
} from '../api/client'
import { useAppStore } from '../store/appContext'

// ─── Component ────────────────────────────────────────────────────────────────

export default function KVExplorer() {
  const { app } = useAppStore()

  const [stores, setStores] = useState<string[]>([])
  const [activeStore, setActiveStore] = useState<string | null>(null)
  const [keys, setKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Value display mode
  const [decodeBase64, setDecodeBase64] = useState(false)

  // Add / Edit form
  const [showForm, setShowForm] = useState(false)
  const [formKey, setFormKey] = useState('')
  const [formValue, setFormValue] = useState('')
  const [formEditing, setFormEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const keyInputRef = useRef<HTMLInputElement>(null)

  // ── Load stores ────────────────────────────────────────────────────────────

  const loadStores = useCallback(async () => {
    try {
      const s = await getKVStores()
      setStores(s)
      if (s.length > 0 && !activeStore) {
        setActiveStore(s[0])
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore])

  useEffect(() => { loadStores() }, [loadStores])

  // ── Load keys when store changes ───────────────────────────────────────────

  const loadKeys = useCallback(async () => {
    if (!activeStore) return
    setLoading(true)
    setError(null)
    setSelectedKey(null)
    setSelectedValue(null)
    try {
      const res = await getKVKeys(activeStore)
      setKeys(res.keys ?? [])
    } catch (e) {
      setError((e as Error).message)
      setKeys([])
    } finally {
      setLoading(false)
    }
  }, [activeStore])

  useEffect(() => { loadKeys() }, [loadKeys])

  // ── Select key ─────────────────────────────────────────────────────────────

  const selectKey = async (key: string) => {
    if (!activeStore) return
    setSelectedKey(key)
    setSelectedValue(null)
    setDecodeBase64(false)
    try {
      const res = await getKVKey(activeStore, key)
      setSelectedValue(res.value)
    } catch (e) {
      setSelectedValue(`[error: ${(e as Error).message}]`)
    }
  }

  // ── Add / Edit ─────────────────────────────────────────────────────────────

  const openAddForm = () => {
    setFormKey('')
    setFormValue('')
    setFormEditing(false)
    setShowForm(true)
    setTimeout(() => keyInputRef.current?.focus(), 50)
  }

  const openEditForm = () => {
    if (!selectedKey || selectedValue === null) return
    setFormKey(selectedKey)
    setFormValue(selectedValue)
    setFormEditing(true)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!activeStore || !formKey) return
    setSaving(true)
    try {
      await setKVKey(activeStore, formKey, formValue)
      setShowForm(false)
      await loadKeys()
      setSelectedKey(formKey)
      setSelectedValue(formValue)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!activeStore || !selectedKey) return
    if (!confirm(`Delete key "${selectedKey}"?`)) return
    try {
      await deleteKVKey(activeStore, selectedKey)
      setSelectedKey(null)
      setSelectedValue(null)
      await loadKeys()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filteredKeys = filter
    ? keys.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
    : keys

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!app?.hasKV) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 p-8">
        <div className="text-center">
          <Database className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium text-gray-500 mb-1">No KV stores</p>
          <p className="text-sm">
            Add a <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">key_value_stores</code> binding
            to a component in spin.toml to enable the KV Explorer.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <Database className="w-5 h-5 text-gray-400" />
        <h1 className="text-lg font-semibold text-gray-800">KV Explorer</h1>
        <div className="flex-1" />
        <button
          onClick={loadKeys}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-50 border-b border-red-100 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* ── Left panel: store tabs + key list ───────────────────────── */}
        <div className="w-80 shrink-0 border-r border-gray-200 flex flex-col bg-white">
          {/* Store tabs */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto shrink-0">
            {stores.map(s => (
              <button
                key={s}
                onClick={() => setActiveStore(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  s === activeStore
                    ? 'bg-spin-seagreen/10 text-spin-seagreen'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                <Database className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                {s}
              </button>
            ))}
          </div>

          {/* Search + Add */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter keys…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-spin-seagreen/40 focus:border-spin-seagreen/40"
              />
            </div>
            <button
              onClick={openAddForm}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-spin-seagreen hover:bg-spin-seagreen/90 rounded-lg transition-colors"
              title="Add key"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Key list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
                Loading…
              </div>
            )}
            {!loading && filteredKeys.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Key className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{keys.length === 0 ? 'No keys in this store' : 'No matching keys'}</p>
              </div>
            )}
            {!loading && filteredKeys.map(k => (
              <button
                key={k}
                onClick={() => selectKey(k)}
                className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-50 transition-colors ${
                  k === selectedKey
                    ? 'bg-spin-seagreen/5 text-spin-seagreen font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Key className="w-3 h-3 shrink-0 opacity-40" />
                  <span className="truncate font-mono text-xs">{k}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Key count */}
          <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 shrink-0">
            {filteredKeys.length}{filter ? ` / ${keys.length}` : ''} key{keys.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Right panel: value viewer / form ────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
          {showForm ? (
            /* ── Add / Edit form ─────────────────────────────────────── */
            <div className="flex-1 flex flex-col p-6 overflow-auto">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">
                {formEditing ? 'Edit key' : 'Add key'}
              </h2>

              <label className="text-xs font-medium text-gray-500 mb-1">Key</label>
              <input
                ref={keyInputRef}
                type="text"
                value={formKey}
                onChange={e => setFormKey(e.target.value)}
                disabled={formEditing}
                placeholder="my-key"
                className="mb-4 px-3 py-2 text-sm font-mono bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-spin-seagreen/40 disabled:opacity-60"
              />

              <label className="text-xs font-medium text-gray-500 mb-1">Value</label>
              <textarea
                value={formValue}
                onChange={e => setFormValue(e.target.value)}
                placeholder="value"
                rows={12}
                className="mb-4 px-3 py-2 text-sm font-mono bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-spin-seagreen/40 resize-y"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !formKey}
                  className="px-4 py-2 text-sm font-medium text-white bg-spin-seagreen hover:bg-spin-seagreen/90 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : formEditing ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : selectedKey ? (
            /* ── Value viewer ────────────────────────────────────────── */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white shrink-0">
                <Key className="w-4 h-4 text-gray-400" />
                <span className="font-mono text-sm text-gray-800 truncate flex-1">{selectedKey}</span>

                {/* Base64 decode toggle — shown when value looks like base64 */}
                {selectedValue !== null && looksLikeBase64(selectedValue) && (
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setDecodeBase64(false)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        !decodeBase64
                          ? 'bg-white text-gray-700 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      Raw
                    </button>
                    <button
                      onClick={() => setDecodeBase64(true)}
                      className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        decodeBase64
                          ? 'bg-white text-gray-700 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <FileCode2 className="w-3 h-3" />
                      Decode Base64
                    </button>
                  </div>
                )}

                <button
                  onClick={openEditForm}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {selectedValue === null ? (
                  <div className="text-gray-400 text-sm">Loading…</div>
                ) : (
                  <pre className="text-sm font-mono text-gray-700 whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-lg p-4">
                    {formatValue(decodeBase64 ? tryDecodeBase64(selectedValue) : selectedValue)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            /* ── Empty state ─────────────────────────────────────────── */
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Key className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a key to view its value</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Heuristic: does this string look like it could be base64-encoded?
 *  Must be at least 8 chars, only base64 alphabet, and length is roughly
 *  right (base64 output is ~4/3 of input, so non-base64 text that happens
 *  to match the alphabet is unlikely for longer strings). */
function looksLikeBase64(value: string): boolean {
  if (value.length < 8) return false
  // Trim surrounding whitespace / newlines for the check
  const trimmed = value.trim()
  return /^[A-Za-z0-9+/\n\r]+=*$/.test(trimmed)
}

/** Try to decode a base64 string. Returns the decoded text or the original
 *  value with an error note if decoding fails. */
function tryDecodeBase64(value: string): string {
  try {
    return atob(value.trim())
  } catch {
    return `[base64 decode failed]\n${value}`
  }
}

/** Try to pretty-print JSON values, fall back to raw string. */
function formatValue(value: string): string {
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}
