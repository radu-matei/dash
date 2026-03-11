import { useEffect, useState } from 'react'
import { AlertCircle, Eye, EyeOff, Search, Settings } from 'lucide-react'
import { getVars, type VarEntry } from '../api/client'

export default function VarInspector() {
  const [vars, setVars] = useState<VarEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  useEffect(() => {
    getVars()
      .then(data => setVars(data ?? []))
      .catch((e: Error) => setError(e.message))
  }, [])

  const filtered = vars.filter(
    v => !search ||
      v.key.toLowerCase().includes(search.toLowerCase()) ||
      v.value.toLowerCase().includes(search.toLowerCase()),
  )

  const toggleReveal = (key: string) =>
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const spinTomlCount  = vars.filter(v => v.source === 'spin.toml').length
  const envCount       = vars.filter(v => v.source === '.env').length
  const spinVarCount   = vars.filter(v => v.source === 'SPIN_VARIABLE').length
  const cliCount       = vars.filter(v => v.source === '--variable').length
  const secretCount    = vars.filter(v => v.secret).length

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Variables</h1>
          {vars.length > 0 && (
            <>
              <span className="badge badge-blue">{spinTomlCount} from spin.toml</span>
              {envCount > 0 && <span className="badge badge-yellow">{envCount} from .env</span>}
              {spinVarCount > 0 && <span className="badge badge-orange">{spinVarCount} from env</span>}
              {cliCount > 0 && <span className="badge badge-green">{cliCount} from --variable</span>}
              {secretCount > 0 && <span className="badge badge-gray">{secretCount} secret{secretCount !== 1 ? 's' : ''}</span>}
            </>
          )}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input text-xs py-1 pl-8 h-8 w-56"
            placeholder="Search variables…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <Settings className="w-8 h-8 opacity-25" />
            <p className="text-sm">{vars.length === 0 ? 'No variables defined.' : 'No matches.'}</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-28">Source</th>
                <th className="w-64">Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => {
                const isRevealed = revealed.has(v.key)
                return (
                  <tr key={i}>
                    <td>
                      <span className={
                        v.source === '.env'           ? 'badge badge-yellow' :
                        v.source === 'SPIN_VARIABLE'  ? 'badge badge-orange' :
                        v.source === '--variable'     ? 'badge badge-green'  :
                                                        'badge badge-blue'
                      }>
                        {v.source === 'SPIN_VARIABLE' ? 'env' : v.source}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-xs text-gray-800">{v.key}</code>
                        {v.secret && (
                          <span className="badge badge-gray text-xs">secret</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {v.secret ? (
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs text-gray-700 select-all">
                            {isRevealed ? (v.value || <span className="text-gray-400 italic">empty</span>) : '••••••••'}
                          </code>
                          <button
                            className="text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                            onClick={() => toggleReveal(v.key)}
                            title={isRevealed ? 'Hide value' : 'Reveal value'}
                          >
                            {isRevealed
                              ? <EyeOff className="w-3.5 h-3.5" />
                              : <Eye className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      ) : (
                        <code className="font-mono text-xs text-gray-700 select-all">
                          {v.value || <span className="text-gray-400 italic">empty</span>}
                        </code>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {vars.length > 0 && (
          <div className="mx-4 my-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <p className="text-xs font-semibold text-gray-700 mb-2">Variable resolution order (highest wins)</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-gray-600">
              <li><span className="badge badge-green mr-1">--variable</span> CLI flag</li>
              <li><span className="badge badge-orange mr-1">env</span> <code className="text-xs">SPIN_VARIABLE_*</code> environment variables</li>
              <li><span className="badge badge-yellow mr-1">.env</span> file</li>
              <li><span className="badge badge-blue mr-1">spin.toml</span> defaults and secret flags</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
