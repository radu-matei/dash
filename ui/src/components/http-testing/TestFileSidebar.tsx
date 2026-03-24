import { useMemo, useState } from 'react'
import {
  Check, ChevronDown, ChevronRight, FlaskConical, FolderOpen, Plus, Search, X,
} from 'lucide-react'
import type { HurlTestFile } from '../../api/client'
import { groupByDir } from './types'
import { HurlIcon } from './HurlEditor'

function StatusDot({ file }: { file: HurlTestFile }) {
  if (!file.lastRun) return null
  if (file.lastRun.success) {
    return <Check className="w-3 h-3 text-green-600 shrink-0" />
  }
  return <X className="w-3 h-3 text-red-500 shrink-0" />
}

export default function TestFileSidebar({
  files,
  selectedPath,
  canEdit,
  onSelectFile,
  onNewTest,
}: {
  files: HurlTestFile[]
  selectedPath: string | null
  canEdit: boolean
  onSelectFile: (path: string) => void
  onNewTest: () => void
}) {
  const [filter, setFilter] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    return new Set(files.map(f => f.dir === '.' ? '/' : f.dir))
  })

  const filteredFiles = useMemo(() => {
    if (!filter) return files
    const q = filter.toLowerCase()
    return files.filter(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    )
  }, [files, filter])

  const groupedFiles = useMemo(() => groupByDir(filteredFiles), [filteredFiles])

  return (
    <>
      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-200 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input text-xs py-1 pl-8 w-full"
            placeholder="Filter tests..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredFiles.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FlaskConical className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs text-gray-500 mb-3">No test files found</p>
            {canEdit && (
              <button onClick={onNewTest} className="btn-accent text-xs h-7 px-3">
                <Plus className="w-3 h-3" /> Create one
              </button>
            )}
          </div>
        ) : (
          Array.from(groupedFiles.entries()).map(([dir, dirFiles]) => (
            <div key={dir}>
              <button
                onClick={() => setExpandedDirs(prev => {
                  const next = new Set(prev)
                  next.has(dir) ? next.delete(dir) : next.add(dir)
                  return next
                })}
                className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                {expandedDirs.has(dir)
                  ? <ChevronDown className="w-3 h-3 shrink-0" />
                  : <ChevronRight className="w-3 h-3 shrink-0" />
                }
                <FolderOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{dir}</span>
              </button>
              {expandedDirs.has(dir) && dirFiles.map(f => (
                <button
                  key={f.path}
                  onClick={() => onSelectFile(f.path)}
                  className={`flex items-center gap-2 w-full text-left pl-8 pr-3 py-1.5 text-xs transition-colors ${
                    f.path === selectedPath
                      ? 'bg-spin-seagreen/10 text-spin-oxfordblue font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <StatusDot file={f} />
                  <HurlIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate font-mono">{f.name}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  )
}
