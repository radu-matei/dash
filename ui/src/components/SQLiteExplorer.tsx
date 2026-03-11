import { useEffect, useState } from 'react'
import { AlertCircle, ChevronRight, Database, Play } from 'lucide-react'
import { execSQLite, getSQLiteTables, querySQLite, type QueryResult } from '../api/client'

export default function SQLiteExplorer() {
  const [tables, setTables] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'query' | 'exec'>('query')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 100

  useEffect(() => {
    getSQLiteTables().then(setTables).catch((e: Error) => setError(e.message))
  }, [])

  const runQuery = async (overrideSql?: string, overrideMode?: typeof mode) => {
    const q = (overrideSql ?? sql).trim()
    const m = overrideMode ?? mode
    if (!q) return
    setLoading(true); setError(null)
    try {
      setResult(m === 'query' ? await querySQLite(q) : await execSQLite(q))
      setPage(0)
    } catch (e: unknown) { setError((e as Error).message); setResult(null) }
    finally { setLoading(false) }
  }

  const loadTable = (table: string) => {
    setSelected(table)
    const q = `SELECT * FROM "${table}" LIMIT 200;`
    setSql(q); runQuery(q, 'query')
  }

  const pagedRows = result?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? []
  const totalPages = result ? Math.ceil(result.rows.length / PAGE_SIZE) : 0

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* Table sidebar */}
      <aside className="w-48 shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="px-3 py-3 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" /> Tables
          </p>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {tables.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2 italic">No tables found</p>
          ) : (
            tables.map(t => (
              <button
                key={t}
                onClick={() => loadTable(t)}
                className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center gap-1.5 transition-colors ${
                  selected === t
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <ChevronRight className={`w-3 h-3 shrink-0 ${selected === t ? 'text-blue-500' : 'text-gray-400'}`} />
                {t}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Query panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="page-header shrink-0">
          <h1 className="page-title">SQLite Explorer</h1>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['query', 'exec'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 transition-colors ${
                  mode === m ? 'bg-fermyon-oxfordblue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {m === 'query' ? 'Read (SELECT)' : 'Write (DML)'}
              </button>
            ))}
          </div>
        </div>

        {/* SQL Editor */}
        <div className="px-4 py-3 border-b border-gray-200 shrink-0 bg-gray-50">
          <textarea
            className="input-mono w-full text-xs h-24 resize-none"
            value={sql}
            onChange={e => setSql(e.target.value)}
            placeholder="SELECT * FROM my_table LIMIT 50;"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runQuery() } }}
          />
          <div className="flex items-center gap-2 mt-2">
            <button className="btn-primary text-xs" onClick={() => runQuery()} disabled={loading}>
              <Play className="w-3.5 h-3.5" />
              {loading ? 'Running…' : 'Run'}
            </button>
            <span className="text-xs text-gray-400">⌘↵ to run</span>
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-700 ml-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto">
          {result && (
            <>
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0">
                <span className="text-xs text-gray-500">
                  {result.rows.length} rows
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 ml-auto">
                    <button className="btn-secondary text-xs py-0.5 px-2" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
                    <span className="text-xs text-gray-500 tabular-nums">{page + 1}/{totalPages}</span>
                    <button className="btn-secondary text-xs py-0.5 px-2" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</button>
                  </div>
                )}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    {result.columns.map(col => <th key={col}>{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="font-mono text-xs" title={cell === null ? 'NULL' : String(cell)}>
                          {cell === null
                            ? <span className="text-gray-400 italic">NULL</span>
                            : <span className="text-gray-800">{String(cell)}</span>
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {!result && !loading && !error && (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
              <Database className="w-8 h-8 opacity-25" />
              <p className="text-sm">Select a table or run a query</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
