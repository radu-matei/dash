import { useState } from 'react'
import { AlertCircle, CheckCircle2, Layers, Loader2, X } from 'lucide-react'
import { addVariable } from '../api/client'
import { useAppStore } from '../store/appContext'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function AddVariableDialog({ onClose, onSuccess }: Props) {
  const { app }                             = useAppStore()
  const components                          = app?.components ?? []

  const [name, setName]                     = useState('')
  const [defaultValue, setDefault]          = useState('')
  const [required, setRequired]             = useState(false)
  const [secret, setSecret]                 = useState(false)
  const [selectedComps, setSelectedComps]   = useState<Set<string>>(new Set())
  const [busy, setBusy]                     = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [done, setDone]                     = useState<string | null>(null)

  const nameValid = /^[a-z_][a-z0-9_]*$/.test(name)

  // Check whether a variable with this name is already declared in [variables].
  // We use app.variableKeys which contains only truly declared app-level variables,
  // not component-level bindings (e.g. api_token = "{{ api_token }}").
  const alreadyExists = (app?.variableKeys ?? []).includes(name)

  function toggleComp(id: string) {
    setSelectedComps(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nameValid || alreadyExists) return
    setBusy(true)
    setError(null)
    try {
      const res = await addVariable(
        name, defaultValue, required, secret,
        [...selectedComps],
      )
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Build spin.toml preview lines
  const varDecl = required
    ? `${name} = { required = true${secret ? ', secret = true' : ''} }`
    : defaultValue
      ? `${name} = { default = "${defaultValue}"${secret ? ', secret = true' : ''} }`
      : `${name} = {${secret ? ' secret = true ' : ''}}`
  const mustache = `{{ ${name} }}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add Variable</h2>
              <p className="text-xs text-gray-500">Writes to <code className="font-mono">[variables]</code> in spin.toml · restarts Spin</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Variable name</label>
            <input
              className={`input-mono w-full ${name && (!nameValid || alreadyExists) ? 'border-red-300 focus:ring-red-200' : ''}`}
              placeholder="api_token"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase())}
              disabled={busy || !!done}
              autoFocus
            />
            {name && !nameValid && (
              <p className="text-xs text-red-500">Lowercase letters, digits, underscores. Must start with a letter or underscore.</p>
            )}
            {name && nameValid && alreadyExists && (
              <p className="text-xs text-red-500">A variable named <code className="font-mono">{name}</code> already exists.</p>
            )}
          </div>

          {/* Default value */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Default value</label>
            <input
              className="input-mono w-full"
              placeholder={required ? '(required — no default)' : 'e.g. http://api.example.com'}
              value={defaultValue}
              onChange={e => setDefault(e.target.value)}
              disabled={busy || !!done || required}
            />
          </div>

          {/* Flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-spin-seagreen"
                checked={required}
                onChange={e => { setRequired(e.target.checked); if (e.target.checked) setDefault('') }}
                disabled={busy || !!done}
              />
              <span className="text-sm text-gray-700">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-spin-seagreen"
                checked={secret}
                onChange={e => setSecret(e.target.checked)}
                disabled={busy || !!done}
              />
              <span className="text-sm text-gray-700">Secret</span>
            </label>
          </div>

          {/* Component wiring */}
          {components.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Expose to components
                </label>
                <button
                  type="button"
                  className="text-xs text-spin-midgreen hover:underline"
                  onClick={() => setSelectedComps(
                    selectedComps.size === components.length
                      ? new Set()
                      : new Set(components.map(c => c.id))
                  )}
                  disabled={busy || !!done}
                >
                  {selectedComps.size === components.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="space-y-1.5">
                {components.map(c => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                      selectedComps.has(c.id)
                        ? 'bg-spin-oxfordblue/5 border-spin-seagreen/40'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-spin-seagreen shrink-0"
                      checked={selectedComps.has(c.id)}
                      onChange={() => toggleComp(c.id)}
                      disabled={busy || !!done}
                    />
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-800 font-mono">{c.id}</span>
                      {selectedComps.has(c.id) && name && nameValid && (
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                          {name} = &quot;{mustache}&quot;
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              {selectedComps.size === 0 && (
                <p className="text-xs text-amber-600">
                  No components selected — the variable will be declared in <code className="font-mono">[variables]</code> but no component will be able to read it until you wire it manually.
                </p>
              )}
            </div>
          )}

          {/* spin.toml preview */}
          {name && nameValid && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">spin.toml preview</p>
              <code className="text-xs font-mono text-gray-700 block">[variables]</code>
              <code className="text-xs font-mono text-gray-800 block">{varDecl}</code>
              {selectedComps.size > 0 && (
                <>
                  <div className="pt-1" />
                  {[...selectedComps].map(id => (
                    <div key={id}>
                      <code className="text-xs font-mono text-gray-700 block">[component.{id}.variables]</code>
                      <code className="text-xs font-mono text-gray-800 block">{name} = &quot;{mustache}&quot;</code>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Error / success */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
          {done && (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{done}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !nameValid || !name || alreadyExists}
              >
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Add Variable'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
