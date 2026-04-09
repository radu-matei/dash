import { Database, RefreshCw, Search, Plus } from 'lucide-react'

interface Props {
  stores: string[]
  activeStore: string | null
  onStoreChange: (store: string) => void
  filter: string
  onFilterChange: (filter: string) => void
  onAddKey: () => void
  loading: boolean
  onRefresh: () => void
  searchRef?: React.RefObject<HTMLInputElement>
}

export default function KVToolbar({
  stores,
  activeStore,
  onStoreChange,
  filter,
  onFilterChange,
  onAddKey,
  loading,
  onRefresh,
  searchRef,
}: Props) {
  return (
    <div className="page-header shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="page-title">KV Explorer</h1>
        {stores.length > 0 && (
          <div className="tab-group">
            {stores.map(s => (
              <button
                key={s}
                onClick={() => onStoreChange(s)}
                className={`tab ${s === activeStore ? 'tab-active' : ''}`}
              >
                <Database className="w-3 h-3" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search keys…"
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            className="input w-44 pl-8 text-xs"
          />
        </div>
        <button onClick={onRefresh} className="btn btn-secondary btn-sm" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={onAddKey} className="btn btn-primary btn-sm">
          <Plus className="w-3.5 h-3.5" />
          Add Key
        </button>
      </div>
    </div>
  )
}
