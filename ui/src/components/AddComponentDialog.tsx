import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Package, X } from 'lucide-react'
import { addComponent } from '../api/client'
import { useAppStore } from '../store/appContext'

const TEMPLATES = [
  { id: 'http-rust',         label: 'Rust',         desc: 'HTTP handler · Rust',          http: true  },
  { id: 'http-go',           label: 'Go',           desc: 'HTTP handler · Go',            http: true  },
  { id: 'http-ts',           label: 'TypeScript',   desc: 'HTTP handler · TypeScript',    http: true  },
  { id: 'http-js',           label: 'JavaScript',   desc: 'HTTP handler · JavaScript',    http: true  },
  { id: 'http-py',           label: 'Python',       desc: 'HTTP handler · Python',        http: true  },
  { id: 'http-c',            label: 'C',            desc: 'HTTP handler · C + Zig',       http: true  },
  { id: 'static-fileserver', label: 'Static files', desc: 'Static file server',           http: true  },
  { id: 'redirect',          label: 'Redirect',     desc: 'HTTP redirect',                http: true  },
  { id: 'redis-rust',        label: 'Redis · Rust', desc: 'Redis trigger · Rust',         http: false },
  { id: 'redis-ts',          label: 'Redis · TS',   desc: 'Redis trigger · TypeScript',   http: false },
]

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function AddComponentDialog({ onClose, onSuccess }: Props) {
  const { app }                   = useAppStore()
  const [template, setTemplate]   = useState(TEMPLATES[0].id)
  const [name, setName]           = useState('')
  const [route, setRoute]         = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [done, setDone]           = useState<string | null>(null)

  const selectedTmpl = TEMPLATES.find(t => t.id === template)!
  const needsRoute   = selectedTmpl.http

  // Auto-suggest a route from the name, updated as the user types.
  useEffect(() => {
    if (name && needsRoute) {
      setRoute(`/${name}/...`)
    } else if (!needsRoute) {
      setRoute('')
    }
  }, [name, needsRoute])

  const nameValid  = /^[a-z0-9][a-z0-9-]*$/.test(name)
  const routeValid = !needsRoute || (route.startsWith('/') && route.length > 1)

  // Check for conflicts against the currently loaded app structure.
  const existingIds    = (app?.components ?? []).map(c => c.id)
  const existingRoutes = (app?.triggers   ?? []).filter(t => t.type === 'http').map(t => t.route ?? '')

  const nameTaken  = existingIds.includes(name)
  const routeTaken = needsRoute && existingRoutes.includes(route)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nameValid || !routeValid || nameTaken || routeTaken) return
    setBusy(true)
    setError(null)
    try {
      const res = await addComponent(template, name, route)
      setDone(res.message)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = nameValid && routeValid && !nameTaken && !routeTaken && !!name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-spin-oxfordblue flex items-center justify-center">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add Component</h2>
              <p className="text-xs text-gray-500">Runs <code className="font-mono">spin add</code> in your app directory</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Template */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Template</label>
            <select
              className="input w-full"
              value={template}
              onChange={e => setTemplate(e.target.value)}
              disabled={busy || !!done}
            >
              {TEMPLATES.map(t => (
                <option key={t.id} value={t.id}>{t.desc}</option>
              ))}
            </select>
          </div>

          {/* Component name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Component name</label>
            <input
              className={`input-mono w-full ${name && (!nameValid || nameTaken) ? 'border-red-300 focus:ring-red-200' : ''}`}
              placeholder="my-handler"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              disabled={busy || !!done}
              autoFocus
            />
            {name && !nameValid && (
              <p className="text-xs text-red-500">Lowercase letters, digits, hyphens only. Must start with a letter or digit.</p>
            )}
            {name && nameValid && nameTaken && (
              <p className="text-xs text-red-500">A component named <code className="font-mono">{name}</code> already exists.</p>
            )}
          </div>

          {/* HTTP route (only for HTTP templates) */}
          {needsRoute && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                HTTP route
                <span className="ml-1.5 font-normal text-gray-400 normal-case tracking-normal">
                  (must be unique — <code className="font-mono">/...</code> matches all)
                </span>
              </label>
              <input
                className={`input-mono w-full ${route && (!routeValid || routeTaken) ? 'border-red-300 focus:ring-red-200' : ''}`}
                placeholder={`/${name || 'my-handler'}/...`}
                value={route}
                onChange={e => setRoute(e.target.value)}
                disabled={busy || !!done}
              />
              {route && !routeValid && (
                <p className="text-xs text-red-500">Route must start with /</p>
              )}
              {route && routeValid && routeTaken && (
                <p className="text-xs text-red-500">
                  Route <code className="font-mono">{route}</code> is already used by another trigger.
                </p>
              )}
              {/* Show existing routes for reference */}
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

          {/* Info */}
          {!done && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>The dashboard will run <code className="font-mono bg-blue-100 px-1 rounded">spin build</code> then restart <code className="font-mono bg-blue-100 px-1 rounded">spin up</code> automatically. Watch the <strong>Logs</strong> tab for progress.</p>
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

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : 'Add Component'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
