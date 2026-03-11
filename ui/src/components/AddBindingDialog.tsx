import { useState } from 'react'
import { AlertCircle, CheckCircle2, Database, Key, Layers, Loader2, X } from 'lucide-react'
import { addBinding, addComponentVariable } from '../api/client'
import type { ComponentInfo } from '../api/client'
import { useAppStore } from '../store/appContext'

interface Props {
  components: ComponentInfo[]
  onClose: () => void
  onSuccess: () => void
  /** Pre-select a component when opened from the component detail pane. */
  initialComponentId?: string
}

type BindingType = 'kv' | 'sqlite' | 'variable'

const TYPE_META: Record<BindingType, { label: string; icon: typeof Key; activeClass: string }> = {
  kv:       { label: 'Key-Value Store',  icon: Key,      activeClass: 'bg-purple-50 border-purple-400 text-purple-700' },
  sqlite:   { label: 'SQLite Database',  icon: Database, activeClass: 'bg-blue-50 border-blue-400 text-blue-700' },
  variable: { label: 'Variable',         icon: Layers,   activeClass: 'bg-amber-50 border-amber-400 text-amber-700' },
}

export default function AddBindingDialog({ components, onClose, onSuccess, initialComponentId }: Props) {
  const { app } = useAppStore()

  const [componentId, setComponentId] = useState(initialComponentId ?? (components[0]?.id ?? ''))
  const [type, setType]               = useState<BindingType>('kv')
  const [storeName, setStoreName]     = useState('')
  const [varName, setVarName]         = useState('')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [done, setDone]               = useState<string | null>(null)

  const storeNameValid = /^[a-z0-9][a-z0-9_-]*$/.test(storeName)

  const selectedComp   = components.find(c => c.id === componentId)
  const existingKV     = selectedComp?.keyValueStores ?? []
  const existingSQLite = selectedComp?.sqliteDatabases ?? []
  const wiredVarKeys   = new Set(Object.keys(selectedComp?.variables ?? {}))

  // App-level declared variables that are not yet wired to this component.
  const unwiredVarKeys = (app?.variableKeys ?? []).filter(k => !wiredVarKeys.has(k))

  function reset() {
    setStoreName('')
    setVarName('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!componentId) return
    if (type === 'variable' && !varName) return
    if ((type === 'kv' || type === 'sqlite') && !storeNameValid) return

    setBusy(true)
    setError(null)
    try {
      let res
      if (type === 'variable') {
        res = await addComponentVariable(componentId, varName)
      } else {
        res = await addBinding(componentId, type, storeName)
      }
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = !busy && !!componentId && (
    type === 'variable' ? !!varName : (storeNameValid && !!storeName)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center">
              <Key className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add Binding</h2>
              <p className="text-xs text-gray-500">Writes to spin.toml · restarts Spin</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Binding type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Binding type</label>
            <div className="flex gap-2">
              {(Object.entries(TYPE_META) as [BindingType, typeof TYPE_META[BindingType]][]).map(([t, meta]) => {
                const Icon = meta.icon
                return (
                  <button
                    key={t}
                    type="button"
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      type === t ? meta.activeClass + ' shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                    onClick={() => { setType(t); reset() }}
                    disabled={busy || !!done}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Component selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Component</label>
            <select
              className="input w-full"
              value={componentId}
              onChange={e => { setComponentId(e.target.value); reset() }}
              disabled={busy || !!done}
            >
              {components.map(c => (
                <option key={c.id} value={c.id}>{c.id}</option>
              ))}
            </select>

            {/* Existing bindings context badges */}
            {type !== 'variable' && (existingKV.length > 0 || existingSQLite.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {existingKV.map(s => (
                  <span key={s} className="badge badge-purple text-[10px]"><Key className="w-2.5 h-2.5" />{s}</span>
                ))}
                {existingSQLite.map(s => (
                  <span key={s} className="badge badge-blue text-[10px]"><Database className="w-2.5 h-2.5" />{s}</span>
                ))}
              </div>
            )}
            {type === 'variable' && wiredVarKeys.size > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {[...wiredVarKeys].map(k => (
                  <span key={k} className="badge badge-gray text-[10px]"><Layers className="w-2.5 h-2.5" />{k}</span>
                ))}
              </div>
            )}
          </div>

          {/* KV / SQLite: store name input */}
          {(type === 'kv' || type === 'sqlite') && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                {type === 'kv' ? 'Store name' : 'Database name'}
              </label>
              <input
                className={`input-mono w-full ${storeName && !storeNameValid ? 'border-red-300 ring-red-200' : ''}`}
                placeholder="default"
                value={storeName}
                onChange={e => setStoreName(e.target.value.toLowerCase())}
                disabled={busy || !!done}
                autoFocus
              />
              {storeName && !storeNameValid && (
                <p className="text-xs text-red-500">Lowercase letters, digits, hyphens, underscores. Must start with a letter or digit.</p>
              )}
              {type === 'kv' && storeName === 'default' && (
                <p className="text-xs text-gray-400">The <code className="font-mono">default</code> store is provided automatically by Spin.</p>
              )}
            </div>
          )}

          {/* Variable: dropdown of unwired declared vars */}
          {type === 'variable' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Variable</label>
              {unwiredVarKeys.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  All declared variables are already wired to this component, or no variables are declared in{' '}
                  <code className="font-mono">[variables]</code> yet.
                </p>
              ) : (
                <select
                  className="input w-full font-mono text-sm"
                  value={varName}
                  onChange={e => setVarName(e.target.value)}
                  disabled={busy || !!done}
                  autoFocus
                >
                  <option value="">Select variable…</option>
                  {unwiredVarKeys.map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Preview */}
          {componentId && (
            <>
              {(type === 'kv' || type === 'sqlite') && storeName && storeNameValid && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">spin.toml preview</p>
                  <code className="text-xs font-mono text-gray-700 block">[component.{componentId}]</code>
                  <code className="text-xs font-mono text-gray-800 block">
                    {type === 'kv' ? 'key_value_stores' : 'sqlite_databases'} = [
                    {[...(type === 'kv' ? existingKV : existingSQLite), storeName].map(s => `"${s}"`).join(', ')}]
                  </code>
                </div>
              )}
              {type === 'variable' && varName && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">spin.toml preview</p>
                  <code className="text-xs font-mono text-gray-700 block">[component.{componentId}.variables]</code>
                  <code className="text-xs font-mono text-gray-800 block">{varName} = &#34;&#123;&#123; {varName} &#125;&#125;&#34;</code>
                </div>
              )}
            </>
          )}

          {/* Error / success */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><p>{error}</p>
            </div>
          )}
          {done && (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /><p>{done}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="submit" className="btn-primary" disabled={!canSubmit}>
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Add Binding'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
