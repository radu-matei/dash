import { useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Link2Off, Loader2, Package, X,
} from 'lucide-react'
import { addComponent, TemplateInfo, TemplateParam } from '../api/client'
import { useAppStore } from '../store/appContext'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function AddComponentDialog({ onClose, onSuccess }: Props) {
  const { app } = useAppStore()

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // ── Template catalogue ────────────────────────────────────────────────────
  const [templates, setTemplates]     = useState<TemplateInfo[]>([])
  const [tmplLoading, setTmplLoading] = useState(true)
  const [tmplError, setTmplError]     = useState(false)

  function loadTemplates() {
    setTmplLoading(true)
    setTmplError(false)

    const controller = new AbortController()
    // Hard 8-second timeout so the dialog never hangs forever.
    const timer = setTimeout(() => controller.abort(), 8000)

    fetch('/api/templates', { signal: controller.signal })
      .then(r => r.json())
      .then((ts: TemplateInfo[] | null) => {
        // Filter to templates that have parameters defined (i.e. usable with
        // spin add) — templates like kv-explorer have null parameters.
        const usable = (ts ?? []).filter(t => t.parameters && t.parameters.length > 0)
        setTemplates(usable)
      })
      .catch(() => setTmplError(true))
      .finally(() => { clearTimeout(timer); setTmplLoading(false) })

    return () => { controller.abort(); clearTimeout(timer) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadTemplates, [])

  // ── Form state ────────────────────────────────────────────────────────────
  const [template, setTemplate]       = useState('')
  const [name, setName]               = useState('')
  const [values, setValues]           = useState<Record<string, string>>({})
  const [privateEndpoint, setPrivate] = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [done, setDone]               = useState<string | null>(null)

  // Set the first template as default once loaded.
  useEffect(() => {
    if (templates.length > 0 && !template) {
      const first = templates[0]
      setTemplate(first.id)
      setValues(defaultValues(first))
    }
  }, [templates])

  // When template changes, reset values to the new template's defaults.
  function handleTemplateChange(id: string) {
    setTemplate(id)
    setPrivate(false)
    setError(null)
    const t = templates.find(t => t.id === id)
    setValues(t ? defaultValues(t) : {})
  }

  const selectedTmpl = templates.find(t => t.id === template) ?? null
  const params       = selectedTmpl?.parameters ?? []
  const httpPathParam = params.find(p => p.is_http_path) ?? null

  // ── Derived state ─────────────────────────────────────────────────────────
  const nameValid  = /^[a-z0-9][a-z0-9-]*$/.test(name)
  const nameTaken  = (app?.components ?? []).map(c => c.id).includes(name)

  const existingRoutes = (app?.triggers ?? [])
    .filter(t => t.type === 'http')
    .map(t => t.route ?? '')

  const httpRoute  = values['http-path'] ?? ''
  const routeValid = !httpPathParam || privateEndpoint
    || (httpRoute.startsWith('/') && httpRoute.length > 1)
  const routeTaken = !privateEndpoint && existingRoutes.includes(httpRoute) && httpRoute !== ''

  // Validate pattern-constrained fields.
  function fieldError(p: TemplateParam): string | null {
    if (p.is_http_path) return null // handled separately
    const val = values[p.id] ?? p.default ?? ''
    if (p.pattern && val !== '' && !new RegExp(p.pattern).test(val)) {
      return `Must match ${p.pattern}`
    }
    return null
  }

  const paramsValid = params.every(p => fieldError(p) === null)
  const canSubmit   = nameValid && routeValid && !nameTaken && !routeTaken
    && !!name && paramsValid && !!template

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const res = await addComponent(template, name, values, privateEndpoint)
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div className="modal max-w-md overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-spin-oxfordblue flex items-center justify-center">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add Component</h2>
              <p className="text-xs text-gray-500">
                Runs <code className="font-mono">spin add</code> in your app directory
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">

          {/* Template selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Template
            </label>
            {tmplLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading templates…
              </div>
            ) : tmplError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-red-500 flex-1">Could not load templates from the server.</p>
                <button
                  type="button"
                  className="text-xs text-blue-600 underline shrink-0"
                  onClick={loadTemplates}
                >Retry</button>
              </div>
            ) : templates.length === 0 ? (
              <p className="text-xs text-amber-600">
                No templates found. Run{' '}
                <code className="font-mono">spin templates install --git https://github.com/fermyon/spin-python-sdk</code>{' '}
                or similar to install templates.
              </p>
            ) : (
              <select
                className="input w-full"
                value={template}
                onChange={e => handleTemplateChange(e.target.value)}
                disabled={busy || !!done}
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.id} — {t.description}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Component name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Component name
            </label>
            <input
              className={`input-mono w-full ${name && (!nameValid || nameTaken) ? 'border-red-300 focus:ring-red-200' : ''}`}
              placeholder="my-handler"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              disabled={busy || !!done}
              autoFocus
            />
            {name && !nameValid && (
              <p className="text-xs text-red-500">
                Lowercase letters, digits, hyphens only. Must start with a letter or digit.
              </p>
            )}
            {name && nameValid && nameTaken && (
              <p className="text-xs text-red-500">
                A component named <code className="font-mono">{name}</code> already exists.
              </p>
            )}
          </div>

          {/* Dynamic template parameters */}
          {params.map(p => {
            if (p.is_http_path) {
              // ── HTTP path — private toggle + route input ──────────────────
              return (
                <div key={p.id} className="space-y-2">
                  {/* Private endpoint toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setPrivate(prev => !prev)
                      setError(null)
                    }}
                    disabled={busy || !!done}
                    className={`flex items-center gap-2 w-full px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                      ${privateEndpoint
                        ? 'bg-violet-50 border-violet-300 text-violet-700'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  >
                    <Link2Off className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 text-left">Private endpoint</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold
                      ${privateEndpoint ? 'bg-violet-200 text-violet-800' : 'bg-gray-200 text-gray-500'}`}>
                      {privateEndpoint ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  {privateEndpoint ? (
                    <p className="text-[11px] text-violet-600 leading-snug">
                      Sets <code className="font-mono">route = {'{ private = true }'}</code>.
                      Reachable only via{' '}
                      <a
                        href="https://spinframework.dev/v3/http-trigger#private-endpoints"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >local service chaining</a>.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        {p.prompt}
                        <span className="ml-1.5 font-normal text-gray-400 normal-case tracking-normal">
                          (must be unique — <code className="font-mono">/...</code> matches all)
                        </span>
                      </label>
                      <input
                        className={`input-mono w-full ${
                          httpRoute && (!routeValid || routeTaken) ? 'border-red-300 focus:ring-red-200' : ''
                        }`}
                        placeholder={p.default ?? `/${name || 'my-handler'}/...`}
                        value={httpRoute}
                        onChange={e => {
                          setValues(v => ({ ...v, 'http-path': e.target.value }))
                        }}
                        disabled={busy || !!done}
                      />
                      {httpRoute && !routeValid && (
                        <p className="text-xs text-red-500">Route must start with /</p>
                      )}
                      {httpRoute && routeValid && routeTaken && (
                        <p className="text-xs text-red-500">
                          Route <code className="font-mono">{httpRoute}</code> is already used by another trigger.
                        </p>
                      )}
                      {existingRoutes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="text-[10px] text-gray-400">In use:</span>
                          {existingRoutes.map(r => (
                            <code key={r} className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{r}</code>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            }

            // ── Generic parameter ─────────────────────────────────────────
            const ferr = fieldError(p)
            const val  = values[p.id] ?? ''
            return (
              <div key={p.id} className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  {p.prompt}
                  {p.default !== undefined && p.default !== '' && (
                    <span className="ml-1.5 font-normal text-gray-400 normal-case tracking-normal">
                      default: <code className="font-mono">{p.default}</code>
                    </span>
                  )}
                </label>
                {p.allowed_values && p.allowed_values.length > 0 ? (
                  <select
                    className="input w-full"
                    value={val || p.default || p.allowed_values[0]}
                    onChange={e => setValues(v => ({ ...v, [p.id]: e.target.value }))}
                    disabled={busy || !!done}
                  >
                    {p.allowed_values.map(av => (
                      <option key={av} value={av}>{av}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`input-mono w-full ${ferr ? 'border-red-300 focus:ring-red-200' : ''}`}
                    placeholder={p.default ?? ''}
                    value={val}
                    onChange={e => setValues(v => ({ ...v, [p.id]: e.target.value }))}
                    disabled={busy || !!done}
                  />
                )}
                {ferr && <p className="text-xs text-red-500">{ferr}</p>}
              </div>
            )
          })}

          {/* Info */}
          {!done && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>
                The dashboard will run{' '}
                <code className="font-mono bg-blue-100 px-1 rounded">spin build</code> then restart{' '}
                <code className="font-mono bg-blue-100 px-1 rounded">spin up</code> automatically.
                Watch the <strong>Logs</strong> tab for progress.
              </p>
            </div>
          )}

          {/* Error / success */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono">{error}</pre>
            </div>
          )}
          {done && (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{done}</p>
            </div>
          )}

          {/* Hub link */}
          <p className="text-xs text-gray-400">
            Looking for more templates?{' '}
            <a
              href="https://spinframework.dev/hub"
              target="_blank"
              rel="noreferrer"
              className="text-blue-500 hover:underline"
            >
              Explore the Spin Hub ↗
            </a>
          </p>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="submit" className="btn-primary" disabled={busy || !canSubmit || tmplLoading}>
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : 'Add Component'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultValues(t: TemplateInfo): Record<string, string> {
  const vals: Record<string, string> = {}
  for (const p of t.parameters) {
    if (p.default !== undefined && p.default !== '') {
      vals[p.id] = p.default
    } else if (p.allowed_values && p.allowed_values.length > 0) {
      vals[p.id] = p.allowed_values[0]
    }
  }
  return vals
}
