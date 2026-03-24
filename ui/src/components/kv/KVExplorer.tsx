import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Database, ExternalLink, Key, Plus, X } from 'lucide-react'
import { getKVStores, getKVKeys, getKVKeyRaw, setKVKey, deleteKVKey } from '../../api/client'
import { useAppStore } from '../../store/appContext'
import { enrichKeyEntry, type KVKeyEntry } from './kvUtils'
import AddServiceBindingDialog from '../AddServiceBindingDialog'
import ResizablePanel from '../ResizablePanel'
import KVToolbar from './KVToolbar'
import KVTable from './KVTable'
import KVDetailPanel from './KVDetailPanel'

export default function KVExplorer() {
  const { app, refresh } = useAppStore()

  // Store & data
  const [stores, setStores] = useState<string[]>([])
  const [activeStore, setActiveStore] = useState<string | null>(null)
  const [keys, setKeys] = useState<KVKeyEntry[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // UI state
  const [filter, setFilter] = useState('')
  const [sortColumn, setSortColumn] = useState<'key' | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dialogs
  const [isNewKey, setIsNewKey] = useState(false)
  const [showBindingDialog, setShowBindingDialog] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  // ── Load stores ──────────────────────────────────────────────────────────

  const loadStores = useCallback(async () => {
    try {
      const s = await getKVStores()
      setStores(s)
      if (s.length > 0 && !activeStore) setActiveStore(s[0])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore])

  useEffect(() => { loadStores() }, [loadStores])

  // ── Load keys ────────────────────────────────────────────────────────────

  const loadKeys = useCallback(async () => {
    if (!activeStore) return
    setLoading(true)
    setError(null)
    setActiveKey(null)
    setSelectedKeys(new Set())
    try {
      const res = await getKVKeys(activeStore)
      setKeys((res.keys ?? []).map(k => ({
        key: k, value: null, type: null, size: null, rawBytes: null,
      })))
    } catch (e) {
      setError((e as Error).message)
      setKeys([])
    } finally {
      setLoading(false)
    }
  }, [activeStore])

  useEffect(() => { loadKeys() }, [loadKeys])

  // ── Select key (fetch value) ─────────────────────────────────────────────

  const selectKey = useCallback(async (key: string) => {
    if (!activeStore) return
    setIsNewKey(false)
    setActiveKey(key)
    try {
      const rawBytes = await getKVKeyRaw(activeStore, key)
      setKeys(prev => prev.map(k =>
        k.key === key ? enrichKeyEntry(key, rawBytes) : k,
      ))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore])

  // ── Delete key ───────────────────────────────────────────────────────────

  const handleDeleteKey = useCallback(async (key: string) => {
    if (!activeStore) return
    if (!confirm(`Delete key "${key}"?`)) return
    try {
      await deleteKVKey(activeStore, key)
      if (activeKey === key) setActiveKey(null)
      await loadKeys()
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore, activeKey, loadKeys])

  // ── Bulk delete ──────────────────────────────────────────────────────────

  const handleBulkDelete = useCallback(async () => {
    if (!activeStore || selectedKeys.size === 0) return
    const keyList = Array.from(selectedKeys)
    if (!confirm(`Delete ${keyList.length} key${keyList.length !== 1 ? 's' : ''}?`)) return
    try {
      for (const key of keyList) {
        await deleteKVKey(activeStore, key)
      }
      setSelectedKeys(new Set())
      if (activeKey && selectedKeys.has(activeKey)) setActiveKey(null)
      await loadKeys()
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore, selectedKeys, activeKey, loadKeys])

  // ── Save value ───────────────────────────────────────────────────────────

  const handleSave = useCallback(async (key: string, value: string | ArrayBuffer) => {
    if (!activeStore) return
    try {
      await setKVKey(activeStore, key, value)
      // Re-fetch to verify round-trip
      const rawBytes = await getKVKeyRaw(activeStore, key)
      setKeys(prev => prev.map(k =>
        k.key === key ? enrichKeyEntry(key, rawBytes) : k,
      ))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activeStore])

  // ── Sort & filter ────────────────────────────────────────────────────────

  const handleSort = useCallback((col: 'key') => {
    if (sortColumn === col) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }, [sortColumn])

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedKeys.size === processedKeys.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(processedKeys.map(k => k.key)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeys])

  // Apply filter + sort
  let processedKeys = keys
  if (filter) {
    const f = filter.toLowerCase()
    processedKeys = processedKeys.filter(k => k.key.toLowerCase().includes(f))
  }
  if (sortColumn) {
    processedKeys = [...processedKeys].sort((a, b) => {
      const cmp = a.key.localeCompare(b.key)
      return sortDirection === 'desc' ? -cmp : cmp
    })
  }

  const activeEntry = keys.find(k => k.key === activeKey) ?? null

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // "/" focuses search
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      // Escape closes detail panel
      if (e.key === 'Escape' && (activeKey || isNewKey)) {
        setIsNewKey(false)
        setActiveKey(null)
        return
      }
      // Arrow keys navigate — only when focus is not inside an editor or input
      const tag = document.activeElement?.tagName
      const inEditor = document.activeElement?.closest('.cm-editor') != null
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && processedKeys.length > 0 && tag !== 'INPUT' && tag !== 'TEXTAREA' && !inEditor) {
        e.preventDefault()
        const idx = activeKey ? processedKeys.findIndex(k => k.key === activeKey) : -1
        const next = e.key === 'ArrowDown'
          ? Math.min(idx + 1, processedKeys.length - 1)
          : Math.max(idx - 1, 0)
        selectKey(processedKeys[next].key)
        return
      }
      // Cmd+S saves in edit mode
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        // Save is handled by the detail panel's CodeMirror
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, isNewKey, processedKeys, selectKey])



  // ── No KV stores empty state ─────────────────────────────────────────────

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
                className="btn btn-primary text-xs h-8 px-4"
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
              className="btn btn-secondary text-xs h-8 px-4"
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
            onSuccess={() => { setShowBindingDialog(false); refresh() }}
          />
        )}
      </div>
    )
  }

  // ── Main layout ──────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <KVToolbar
        stores={stores}
        activeStore={activeStore}
        onStoreChange={s => { setActiveStore(s); setFilter('') }}
        filter={filter}
        onFilterChange={setFilter}
        onAddKey={() => {
          setActiveKey(null)
          setIsNewKey(true)
        }}
        loading={loading}
        onRefresh={loadKeys}
        searchRef={searchRef}
      />

      {error && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-50 border-b border-red-100 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="btn btn-ghost btn-icon text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <ResizablePanel
        storageKey="kv-panel"
        defaultWidth={300}
        minWidth={220}
        maxWidth={500}
        panel={
          loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Loading…
            </div>
          ) : (
            <KVTable
              keys={processedKeys}
              selectedKeys={selectedKeys}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              activeKey={activeKey}
              onSelectKey={selectKey}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              onBulkDelete={handleBulkDelete}
              onDeleteKey={handleDeleteKey}
              filter={filter}
              totalCount={keys.length}
            />
          )
        }
      >
        {/* Right side: detail panel or empty state */}
        {isNewKey ? (
          <KVDetailPanel
            entry={{ key: '__new__', value: '', type: null, size: null, rawBytes: null }}
            isNew
            onClose={() => setIsNewKey(false)}
            onSave={async (key, value) => {
              await handleSave(key, value)
              setIsNewKey(false)
              await loadKeys()
              selectKey(key)
            }}
            onDelete={() => setIsNewKey(false)}
          />
        ) : activeEntry ? (
          <KVDetailPanel
            entry={activeEntry}
            onClose={() => setActiveKey(null)}
            onSave={handleSave}
            onDelete={handleDeleteKey}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 bg-gray-50">
            <div className="text-center">
              <Key className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a key to view its value</p>
            </div>
          </div>
        )}
      </ResizablePanel>
      {showBindingDialog && (
        <AddServiceBindingDialog
          components={app?.components ?? []}
          onClose={() => setShowBindingDialog(false)}
          onSuccess={() => { setShowBindingDialog(false); refresh() }}
        />
      )}
    </div>
  )
}
