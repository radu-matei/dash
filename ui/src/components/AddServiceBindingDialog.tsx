import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, Globe, Key, Loader2, Sparkles, X } from 'lucide-react'
import { addBinding } from '../api/client'
import type { ComponentInfo } from '../api/client'

interface Props {
  components: ComponentInfo[]
  onClose: () => void
  onSuccess: () => void
  /** Pre-select a component when opened from the component detail pane. */
  initialComponentId?: string
}

type ServiceBindingType = 'kv' | 'sqlite' | 'ai' | 'outbound-host'

const TYPE_META: Record<ServiceBindingType, {
  label: string
  icon: typeof Key
  activeClass: string
  fieldLabel: string
  placeholder: string
  hint?: string
  tomlField: string
  forceLower: boolean
}> = {
  kv: {
    label: 'Key-Value',
    icon: Key,
    activeClass: 'bg-purple-50 border-purple-400 text-purple-700',
    fieldLabel: 'Store name',
    placeholder: 'default',
    hint: 'The "default" store is provided automatically by Spin.',
    tomlField: 'key_value_stores',
    forceLower: true,
  },
  sqlite: {
    label: 'SQLite',
    icon: Database,
    activeClass: 'bg-blue-50 border-blue-400 text-blue-700',
    fieldLabel: 'Database name',
    placeholder: 'default',
    hint: 'The "default" database is provided automatically by Spin.',
    tomlField: 'sqlite_databases',
    forceLower: true,
  },
  ai: {
    label: 'AI Model',
    icon: Sparkles,
    activeClass: 'bg-indigo-50 border-indigo-400 text-indigo-700',
    fieldLabel: 'Model name',
    placeholder: 'llama2-chat',
    hint: 'e.g. llama2-chat, codellama-instruct, llama3-8b-instruct',
    tomlField: 'ai_models',
    forceLower: true,
  },
  'outbound-host': {
    label: 'Outbound HTTP',
    icon: Globe,
    activeClass: 'bg-teal-50 border-teal-400 text-teal-700',
    fieldLabel: 'URL pattern',
    placeholder: 'https://api.example.com',
    hint: 'Wildcards allowed — e.g. https://*.example.com or * for any host.',
    tomlField: 'allowed_outbound_hosts',
    forceLower: false,
  },
}

export default function AddServiceBindingDialog({ components, onClose, onSuccess, initialComponentId }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const [componentId, setComponentId] = useState(initialComponentId ?? (components[0]?.id ?? ''))
  const [type, setType]               = useState<ServiceBindingType>('kv')
  const [value, setValue]             = useState('')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [done, setDone]               = useState<string | null>(null)

  const meta         = TYPE_META[type]
  const selectedComp = components.find(c => c.id === componentId)

  // Existing values for the selected type on the selected component.
  const existingValues: string[] = {
    kv:              selectedComp?.keyValueStores        ?? [],
    sqlite:          selectedComp?.sqliteDatabases       ?? [],
    ai:              selectedComp?.aiModels              ?? [],
    'outbound-host': selectedComp?.allowedOutboundHosts  ?? [],
  }[type]

  // Validate store / database names (kv and sqlite only).
  const nameValid = (type === 'kv' || type === 'sqlite')
    ? /^[a-z0-9][a-z0-9_-]*$/.test(value)
    : true

  function reset() {
    setValue('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!componentId || !value || !nameValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await addBinding(componentId, type, value)
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = !busy && !!componentId && !!value && nameValid

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center">
              <Key className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add Service Binding</h2>
              <p className="text-xs text-gray-500">Writes to spin.toml · restarts Spin</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Service type selector — 2×2 grid */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Service type</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(TYPE_META) as [ServiceBindingType, typeof TYPE_META[ServiceBindingType]][]).map(([t, m]) => {
                const Icon = m.icon
                return (
                  <button
                    key={t}
                    type="button"
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      type === t ? m.activeClass + ' shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                    onClick={() => { setType(t); reset() }}
                    disabled={busy || !!done}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {m.label}
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
            {/* Existing bindings context */}
            {existingValues.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {existingValues.map((s: string) => {
                  const Icon = meta.icon
                  return (
                    <span key={s} className="badge badge-gray text-[10px]">
                      <Icon className="w-2.5 h-2.5" />{s}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Service value input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">{meta.fieldLabel}</label>
            <input
              className={`input-mono w-full ${value && !nameValid ? 'border-red-300 ring-red-200' : ''}`}
              placeholder={meta.placeholder}
              value={value}
              onChange={e => setValue(meta.forceLower ? e.target.value.toLowerCase() : e.target.value)}
              disabled={busy || !!done}
              autoFocus
            />
            {value && !nameValid && (
              <p className="text-xs text-red-500">Lowercase letters, digits, hyphens, underscores. Must start with a letter or digit.</p>
            )}
            {meta.hint && !(value && !nameValid) && (
              <p className="text-xs text-gray-400">{meta.hint}</p>
            )}
          </div>

          {/* spin.toml preview */}
          {componentId && value && nameValid && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">spin.toml preview</p>
              <code className="text-xs font-mono text-gray-700 block">[component.{componentId}]</code>
              <code className="text-xs font-mono text-gray-800 block">
                {meta.tomlField} = [{[...existingValues, value].map((s: string) => `"${s}"`).join(', ')}]
              </code>
            </div>
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
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Add Service Binding'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
