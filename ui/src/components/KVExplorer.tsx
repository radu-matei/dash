import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle, Database, ExternalLink, FileCode2, Key, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import {
  getKVStores, getKVKeys, getKVKey, setKVKey, deleteKVKey,
} from '../api/client'
import { useAppStore } from '../store/appContext'
import AddServiceBindingDialog from './AddServiceBindingDialog'
import ResizablePanel from './ResizablePanel'

// ─── Component ────────────────────────────────────────────────────────────────

export default function KVExplorer() {
  const { app, refresh } = useAppStore()

  const [stores, setStores] = useState<string[]>([])
  const [activeStore, setActiveStore] = useState<string | null>(null)
  const [keys, setKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Second-layer base64 decode (for values that are themselves base64)
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
    setFormValue(decodeBase64Value(selectedValue))
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
      // Re-fetch from the API so we get the properly encoded value.
      setSelectedKey(formKey)
      try {
        const res = await getKVKey(activeStore, formKey)
        setSelectedValue(res.value)
      } catch {
        setSelectedValue(null)
      }
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

  // Add binding dialog (shown on empty state when --allow-edits)
  const [showBindingDialog, setShowBindingDialog] = useState(false)

  if (!app?.hasKV) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="page-header shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="page-title">KV Explorer</h1>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4 px-8">
          <Database className="w-12 h-12 opacity-20" />
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-gray-500">No KV stores configured</p>
            <p className="text-xs text-gray-400 max-w-sm">
              Add a <code className="font-mono">key_value_stores</code> binding
              to a component in your spin.toml to start using the KV Explorer.
            </p>
          </div>
          <pre className="text-left text-xs font-mono bg-gray-50 border border-gray-200 rounded-14 p-5 text-gray-500 max-w-sm w-full">
{`[component.my-app]
source = "app.wasm"
key_value_stores = ["default"]`}
          </pre>
          <div className="flex gap-2">
            {app?.allowMutations ? (
              <button
                onClick={() => setShowBindingDialog(true)}
                className="btn-primary text-xs h-8 px-4"
              >
                <Plus className="w-3.5 h-3.5" /> Add KV Store Binding
              </button>
            ) : (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 shrink-0" />
                Pass <code className="font-mono">--allow-edits</code> to add bindings
              </span>
            )}
            <a
              href="https://developer.fermyon.com/spin/v3/key-value-store-tutorial"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs h-8 px-4"
            >
              KV Store guide
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
        {showBindingDialog && (
          <AddServiceBindingDialog
            components={app?.components ?? []}
            onClose={() => setShowBindingDialog(false)}
            onSuccess={() => {
              setShowBindingDialog(false)
              refresh()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">KV Explorer</h1>
        </div>
        <button
          onClick={loadKeys}
          className="btn-secondary text-xs h-8 px-3"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-50 border-b border-red-100 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="btn-ghost btn-icon text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <ResizablePanel
        storageKey="kv-panel"
        defaultWidth={288}
        minWidth={200}
        maxWidth={480}
        panel={
          <>
            {/* Store tabs */}
            <div className="flex items-center px-3 py-2 border-b border-gray-100 overflow-x-auto shrink-0">
              <div className="tab-group">
                {stores.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveStore(s)}
                    className={`tab ${s === activeStore ? 'tab-active' : ''}`}
                  >
                    <Database className="w-3 h-3" />
                    {s}
                  </button>
                ))}
              </div>
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
                  className="input w-full pl-8 text-xs"
                />
              </div>
              <button
                onClick={openAddForm}
                className="btn-accent btn-sm"
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
                      ? 'bg-spin-oxfordblue/5 text-spin-oxfordblue font-medium'
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
          </>
        }
      >
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
                className="input-mono mb-4 disabled:opacity-60"
              />

              <label className="text-xs font-medium text-gray-500 mb-1">Value</label>
              <textarea
                value={formValue}
                onChange={e => setFormValue(e.target.value)}
                placeholder="value"
                rows={12}
                className="input-mono mb-4 resize-y"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !formKey}
                  className="btn-primary"
                >
                  {saving ? 'Saving…' : formEditing ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="btn-secondary"
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

                {/* Second-layer base64 decode toggle — for values that are
                    themselves base64 in the store (the transport layer encoding
                    is always stripped automatically). */}
                {selectedValue !== null && looksLikeBase64(decodeBase64Value(selectedValue)) && (
                  <div className="tab-group">
                    <button
                      onClick={() => setDecodeBase64(false)}
                      className={`tab ${!decodeBase64 ? 'tab-active' : ''}`}
                    >
                      Raw
                    </button>
                    <button
                      onClick={() => setDecodeBase64(true)}
                      className={`tab ${decodeBase64 ? 'tab-active' : ''}`}
                    >
                      <FileCode2 className="w-3 h-3" />
                      Decode Base64
                    </button>
                  </div>
                )}

                <button
                  onClick={openEditForm}
                  className="btn-ghost btn-sm"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="btn-danger btn-sm"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {selectedValue === null ? (
                  <div className="text-gray-400 text-sm">Loading…</div>
                ) : (
                  <ValueDisplay value={(() => {
                    const decoded = decodeBase64Value(selectedValue)
                    return decodeBase64 ? decodeBase64Value(decoded) : decoded
                  })()} />
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
      </ResizablePanel>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Heuristic: does this string look like it could be base64-encoded?
 *  Must be at least 8 chars, only base64 alphabet + padding. */
function looksLikeBase64(value: string): boolean {
  if (value.length < 8) return false
  return /^[A-Za-z0-9+/\n\r]+=*$/.test(value.trim())
}

/** Decode a base64-encoded value from the KV explorer API.
 *  Go's json.Marshal automatically base64-encodes []byte fields, so all
 *  values arrive base64-encoded. We decode them to show the real content. */
function decodeBase64Value(value: string): string {
  try {
    return atob(value.trim())
  } catch {
    // If decoding fails, the value might already be a plain string
    return value
  }
}

/** Render a value with JSON syntax highlighting when applicable. */
function ValueDisplay({ value }: { value: string }) {
  // Try to parse as JSON for syntax highlighting
  let json: unknown = undefined
  try { json = JSON.parse(value) } catch { /* not JSON */ }

  if (json !== undefined) {
    const pretty = JSON.stringify(json, null, 2)
    return (
      <pre className="text-sm font-mono whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-14 p-5 leading-relaxed">
        {highlightJSON(pretty)}
      </pre>
    )
  }

  return (
    <pre className="text-sm font-mono text-gray-700 whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-14 p-5">
      {value}
    </pre>
  )
}

/** Tokenize and syntax-highlight a JSON string. */
function highlightJSON(json: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Regex matches: strings, numbers, booleans, null, braces/brackets, colons/commas
  const re = /("(?:[^"\\]|\\.)*")\s*(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\]])|([,:])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(json)) !== null) {
    // Whitespace/newlines between tokens
    if (match.index > lastIndex) {
      nodes.push(json.slice(lastIndex, match.index))
    }

    if (match[1] !== undefined) {
      if (match[2] !== undefined) {
        // Key string followed by colon
        nodes.push(<span key={match.index} className="text-purple-600">{match[1]}</span>)
        nodes.push(<span key={match.index + 'c'} className="text-gray-400">{match[2]}</span>)
      } else {
        // Value string
        nodes.push(<span key={match.index} className="text-emerald-600">{match[1]}</span>)
      }
    } else if (match[3] !== undefined) {
      // Number
      nodes.push(<span key={match.index} className="text-blue-600">{match[3]}</span>)
    } else if (match[4] !== undefined) {
      // Boolean
      nodes.push(<span key={match.index} className="text-amber-600 font-medium">{match[4]}</span>)
    } else if (match[5] !== undefined) {
      // null
      nodes.push(<span key={match.index} className="text-red-400 font-medium">{match[5]}</span>)
    } else if (match[6] !== undefined) {
      // Braces / brackets
      nodes.push(<span key={match.index} className="text-gray-500">{match[6]}</span>)
    } else if (match[7] !== undefined) {
      // Comma / colon
      nodes.push(<span key={match.index} className="text-gray-400">{match[7]}</span>)
    }

    lastIndex = re.lastIndex
  }

  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex))
  }

  return nodes
}
