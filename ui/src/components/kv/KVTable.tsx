import { ChevronDown, ChevronUp, Key, Trash2 } from 'lucide-react'
import type { KVKeyEntry } from './kvUtils'

interface Props {
  keys: KVKeyEntry[]
  selectedKeys: Set<string>
  onToggleSelect: (key: string) => void
  onToggleSelectAll: () => void
  activeKey: string | null
  onSelectKey: (key: string) => void
  sortColumn: 'key' | null
  sortDirection: 'asc' | 'desc'
  onSort: (column: 'key') => void
  onBulkDelete: () => void
  onDeleteKey: (key: string) => void
  filter: string
  totalCount: number
}

export default function KVTable({
  keys,
  selectedKeys,
  onToggleSelect,
  onToggleSelectAll,
  activeKey,
  onSelectKey,
  sortColumn,
  sortDirection,
  onSort,
  onBulkDelete,
  onDeleteKey,
  filter,
  totalCount,
}: Props) {
  const allSelected = keys.length > 0 && keys.every(k => selectedKeys.has(k.key))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with sort + select all */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleSelectAll}
          className="w-3.5 h-3.5 rounded shrink-0"
          title="Select all"
        />
        <button
          onClick={() => onSort('key')}
          className="group inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
        >
          Keys
          {sortColumn === 'key' ? (
            sortDirection === 'asc'
              ? <ChevronUp className="w-3 h-3 text-spin-oxfordblue" />
              : <ChevronDown className="w-3 h-3 text-spin-oxfordblue" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />
          )}
        </button>
      </div>

      {/* Key list */}
      <div className="flex-1 overflow-y-auto">
        {keys.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Key className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm font-medium text-gray-700">
              {filter ? 'No matching keys' : 'No keys in this store'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {filter ? 'Try a different search term' : 'Add a key to get started'}
            </p>
          </div>
        )}
        {keys.map(entry => {
          const isActive = entry.key === activeKey
          const isSelected = selectedKeys.has(entry.key)
          return (
            <div
              key={entry.key}
              className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 transition-colors group ${
                isActive
                  ? 'bg-spin-oxfordblue/5'
                  : 'hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(entry.key)}
                className="w-3.5 h-3.5 rounded shrink-0"
              />
              <button
                onClick={() => onSelectKey(entry.key)}
                className={`flex-1 text-left truncate font-mono text-xs ${
                  isActive ? 'text-spin-oxfordblue font-semibold' : 'text-gray-700'
                }`}
                title={entry.key}
              >
                {entry.key}
              </button>
              <button
                onClick={() => onDeleteKey(entry.key)}
                className="btn btn-ghost btn-icon text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Status bar */}
      <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-400 shrink-0 flex items-center justify-between">
        <span>
          {keys.length}{filter ? ` / ${totalCount}` : ''} key{totalCount !== 1 ? 's' : ''}
          {selectedKeys.size > 0 && ` · ${selectedKeys.size} selected`}
        </span>
        {selectedKeys.size > 0 && (
          <button
            onClick={onBulkDelete}
            className="text-red-600 font-medium hover:text-red-700 transition-colors"
          >
            Delete ({selectedKeys.size})
          </button>
        )}
      </div>
    </div>
  )
}
