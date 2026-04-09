import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, GitMerge, Layers, Loader2, Plus, X } from 'lucide-react'
import { addComponentVariable, addVariable } from '../api/client'
import { useAppStore } from '../store/appContext'

interface Props {
  onClose: () => void
  onSuccess: () => void
  /** Open directly into 'wire' mode when launched from a component context. */
  initialMode?: 'new' | 'wire'
}

export default function AddVariableDialog({ onClose, onSuccess, initialMode = 'new' }: Props) {
  const { app }    = useAppStore()
  const components = app?.components ?? []

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const [mode, setMode] = useState<'new' | 'wire'>(initialMode)

  // ── "New variable" state ──────────────────────────────────────────────────
  const [name, setName]                   = useState('')
  const [defaultValue, setDefault]        = useState('')
  const [required, setRequired]           = useState(false)
  const [secret, setSecret]               = useState(false)
  const [selectedComps, setSelectedComps] = useState<Set<string>>(new Set())

  // ── "Wire to component" state ─────────────────────────────────────────────
  const [wireCompId, setWireCompId]   = useState(components[0]?.id ?? '')
  const [wireVarName, setWireVarName] = useState('')

  // ── Shared async state ────────────────────────────────────────────────────
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone]   = useState<string | null>(null)

  // ── "New variable" derived ────────────────────────────────────────────────
  const nameValid     = /^[a-z_][a-z0-9_]*$/.test(name)
  const alreadyExists = (app?.variableKeys ?? []).includes(name)

  // ── "Wire to component" derived ───────────────────────────────────────────
  const wireComp       = components.find(c => c.id === wireCompId)
  const wiredVarKeys   = new Set(Object.keys(wireComp?.variables ?? {}))
  const unwiredVarKeys = (app?.variableKeys ?? []).filter(k => !wiredVarKeys.has(k))

  function switchMode(m: 'new' | 'wire') {
    setMode(m)
    setError(null)
    setDone(null)
    setWireVarName('')
  }

  function toggleComp(id: string) {
    setSelectedComps(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'new' && (!nameValid || alreadyExists)) return
    if (mode === 'wire' && (!wireCompId || !wireVarName)) return
    setBusy(true)
    setError(null)
    try {
      const res = mode === 'new'
        ? await addVariable(name, defaultValue, required, secret, [...selectedComps])
        : await addComponentVariable(wireCompId, wireVarName)
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // spin.toml preview helpers (new-variable mode)
  const varDecl = required
    ? `${name} = { required = true${secret ? ', secret = true' : ''} }`
    : defaultValue
      ? `${name} = { default = "${defaultValue}"${secret ? ', secret = true' : ''} }`
      : `${name} = {${secret ? ' secret = true ' : ''}}`
  const mustache = `{{ ${name} }}`

  const canSubmitNew  = !busy && !!name && nameValid && !alreadyExists
  const canSubmitWire = !busy && !!wireCompId && !!wireVarName

  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div className="modal max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Variable</h2>
              <p className="text-xs text-gray-500">Writes to spin.toml · restarts Spin</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">

          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                mode === 'new'
                  ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-sm'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
              onClick={() => switchMode('new')}
              disabled={busy || !!done}
            >
              <Plus className="w-3.5 h-3.5" />
              New variable
            </button>
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                mode === 'wire'
                  ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-sm'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
              onClick={() => switchMode('wire')}
              disabled={busy || !!done}
            >
              <GitMerge className="w-3.5 h-3.5" />
              Wire to component
            </button>
          </div>

          {/* ── New variable form ──────────────────────────────────────────────── */}
          {mode === 'new' && (
            <>
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
                      No components selected — the variable will be declared in <code className="font-mono">[variables]</code> but no component can read it until wired.
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
            </>
          )}

          {/* ── Wire to component form ────────────────────────────────────────── */}
          {mode === 'wire' && (
            <>
              {/* Component selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Component</label>
                <select
                  className="input w-full"
                  value={wireCompId}
                  onChange={e => { setWireCompId(e.target.value); setWireVarName('') }}
                  disabled={busy || !!done}
                  autoFocus
                >
                  {components.map(c => (
                    <option key={c.id} value={c.id}>{c.id}</option>
                  ))}
                </select>
                {wiredVarKeys.size > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {[...wiredVarKeys].map(k => (
                      <span key={k} className="badge badge-gray text-[10px]">
                        <Layers className="w-2.5 h-2.5" />{k}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Variable selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Variable</label>
                {unwiredVarKeys.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    All declared variables are already wired to this component, or none have been declared in{' '}
                    <code className="font-mono">[variables]</code> yet. Use <strong>New variable</strong> to create one.
                  </p>
                ) : (
                  <select
                    className="input w-full font-mono text-sm"
                    value={wireVarName}
                    onChange={e => setWireVarName(e.target.value)}
                    disabled={busy || !!done}
                  >
                    <option value="">Select variable…</option>
                    {unwiredVarKeys.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* spin.toml preview */}
              {wireCompId && wireVarName && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">spin.toml preview</p>
                  <code className="text-xs font-mono text-gray-700 block">[component.{wireCompId}.variables]</code>
                  <code className="text-xs font-mono text-gray-800 block">{wireVarName} = &#34;&#123;&#123; {wireVarName} &#125;&#125;&#34;</code>
                </div>
              )}
            </>
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
          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button
                type="submit"
                className="btn-primary"
                disabled={mode === 'new' ? !canSubmitNew : !canSubmitWire}
              >
                {busy
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                  : mode === 'new' ? 'Add Variable' : 'Wire Variable'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
